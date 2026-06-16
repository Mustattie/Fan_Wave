-- 056: Two QA-found fixes that block the v8 ship gate.
--
-- 1. Repair pre-v8 Soccer Cup watch parties that have the wrong event_id.
--    create-watch-party.tsx and WCWatchParties.tsx were stamping
--    'e0260000-0000-0000-0000-000000002026' on Soccer-Cup-tab inserts
--    instead of the canonical seeded 'e0000000-0000-0000-0000-000000002026'.
--    The mismatch made the DB-side WC gate (migration 053 watch_party_rsvps
--    policy) treat those parties as non-WC — free users could RSVP
--    them without WC Pass. v8 client now imports the canonical ID from
--    constants/WorldCupIds, but the existing rows still have the wrong
--    value, so we backfill here.
--
-- 2. Dedupe suggest_fan_groups so Section 2 (city_sport) and Section 4
--    (city_any) don't both surface the same group when it satisfies
--    both filters. Section 4 now explicitly excludes the sport_ids
--    Section 2 would have returned.

UPDATE public.watch_parties
   SET event_id = 'e0000000-0000-0000-0000-000000002026'::UUID
 WHERE event_id = 'e0260000-0000-0000-0000-000000002026'::UUID;

CREATE OR REPLACE FUNCTION public.suggest_fan_groups(p_user_auth_id UUID)
RETURNS TABLE (
    id           UUID,
    name         TEXT,
    description  TEXT,
    group_type   TEXT,
    sport_id     UUID,
    event_id     UUID,
    team_id      UUID,
    city         TEXT,
    tags         TEXT[],
    visibility   TEXT,
    owner_id     UUID,
    member_count INT,
    avatar_url   TEXT,
    created_at   TIMESTAMPTZ,
    reason       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_home_city   TEXT;
    v_fav_teams   UUID[];
    v_wc_enabled  BOOLEAN := FALSE;
    v_country     TEXT;
BEGIN
    SELECT u.home_city, COALESCE(u.favorite_team_ids, '{}'::UUID[])
      INTO v_home_city, v_fav_teams
      FROM public.users u
     WHERE u.auth_id = p_user_auth_id
     LIMIT 1;

    SELECT COALESCE(ff.enabled, FALSE)
      INTO v_wc_enabled
      FROM public.feature_flags ff
     WHERE ff.key = 'world_cup_mode'
     LIMIT 1;

    -- Section 1: followed-team groups.
    RETURN QUERY
    SELECT cr.id, cr.name, cr.description, cr.group_type, cr.sport_id, cr.event_id,
           cr.team_id, cr.city, cr.tags, cr.visibility, cr.owner_id, cr.member_count,
           cr.avatar_url, cr.created_at,
           'team'::TEXT AS reason
      FROM public.chat_rooms cr
     WHERE cr.group_type = 'sports'
       AND cr.visibility = 'public'
       AND cr.owner_id IS DISTINCT FROM p_user_auth_id
       AND NOT EXISTS (
         SELECT 1 FROM public.chat_room_members m
         WHERE m.chat_room_id = cr.id AND m.user_id = p_user_auth_id
       )
       AND (
         cr.team_id IN (
           SELECT utf.team_id FROM public.user_team_follows utf
            WHERE utf.user_id = p_user_auth_id
         )
         OR cr.team_id = ANY(v_fav_teams)
       )
     ORDER BY cr.member_count DESC NULLS LAST
     LIMIT 12;

    -- Section 2: city + sport-interest groups (excluding Section 1 hits).
    IF v_home_city IS NOT NULL AND length(v_home_city) > 0 THEN
        RETURN QUERY
        SELECT DISTINCT ON (cr.id)
               cr.id, cr.name, cr.description, cr.group_type, cr.sport_id, cr.event_id,
               cr.team_id, cr.city, cr.tags, cr.visibility, cr.owner_id, cr.member_count,
               cr.avatar_url, cr.created_at,
               'city_sport'::TEXT AS reason
          FROM public.chat_rooms cr
         WHERE cr.group_type = 'sports'
           AND cr.visibility = 'public'
           AND cr.city = v_home_city
           AND cr.owner_id IS DISTINCT FROM p_user_auth_id
           AND NOT EXISTS (
             SELECT 1 FROM public.chat_room_members m
             WHERE m.chat_room_id = cr.id AND m.user_id = p_user_auth_id
           )
           AND cr.sport_id IN (
               SELECT DISTINCT l.sport_id
                 FROM public.user_team_follows utf2
                 JOIN public.teams t   ON t.id = utf2.team_id
                 JOIN public.leagues l ON l.id = t.league_id
                WHERE utf2.user_id = p_user_auth_id
               UNION
               SELECT DISTINCT l.sport_id
                 FROM public.teams t
                 JOIN public.leagues l ON l.id = t.league_id
                WHERE t.id = ANY(v_fav_teams)
           )
           AND cr.team_id NOT IN (
             SELECT utf3.team_id FROM public.user_team_follows utf3
              WHERE utf3.user_id = p_user_auth_id
             UNION
             SELECT unnest(v_fav_teams)
           )
         ORDER BY cr.id, cr.member_count DESC NULLS LAST
         LIMIT 12;
    END IF;

    -- Section 3: WC country group when feature flag is on.
    IF v_wc_enabled THEN
        v_country := 'USA';
        RETURN QUERY
        SELECT cr.id, cr.name, cr.description, cr.group_type, cr.sport_id, cr.event_id,
               cr.team_id, cr.city, cr.tags, cr.visibility, cr.owner_id, cr.member_count,
               cr.avatar_url, cr.created_at,
               'wc_country'::TEXT AS reason
          FROM public.chat_rooms cr
          JOIN public.teams t ON t.id = cr.team_id
         WHERE cr.group_type = 'worldcup'
           AND cr.visibility = 'public'
           AND cr.owner_id IS DISTINCT FROM p_user_auth_id
           AND NOT EXISTS (
             SELECT 1 FROM public.chat_room_members m
             WHERE m.chat_room_id = cr.id AND m.user_id = p_user_auth_id
           )
           AND (t.code = v_country OR t.name = 'United States')
         ORDER BY cr.member_count DESC NULLS LAST
         LIMIT 3;
    END IF;

    -- Section 4: generic city fallback — public sports groups in the user's
    -- city that DIDN'T match a sport they're already interested in (those
    -- are returned by Section 2). Otherwise the same row would show up in
    -- both sections; the client surface would render it twice.
    IF v_home_city IS NOT NULL AND length(v_home_city) > 0 THEN
        RETURN QUERY
        SELECT cr.id, cr.name, cr.description, cr.group_type, cr.sport_id, cr.event_id,
               cr.team_id, cr.city, cr.tags, cr.visibility, cr.owner_id, cr.member_count,
               cr.avatar_url, cr.created_at,
               'city_any'::TEXT AS reason
          FROM public.chat_rooms cr
         WHERE cr.group_type = 'sports'
           AND cr.visibility = 'public'
           AND cr.city = v_home_city
           AND cr.owner_id IS DISTINCT FROM p_user_auth_id
           AND NOT EXISTS (
             SELECT 1 FROM public.chat_room_members m
             WHERE m.chat_room_id = cr.id AND m.user_id = p_user_auth_id
           )
           AND cr.sport_id NOT IN (
               SELECT DISTINCT l.sport_id
                 FROM public.user_team_follows utf2
                 JOIN public.teams t   ON t.id = utf2.team_id
                 JOIN public.leagues l ON l.id = t.league_id
                WHERE utf2.user_id = p_user_auth_id
               UNION
               SELECT DISTINCT l.sport_id
                 FROM public.teams t
                 JOIN public.leagues l ON l.id = t.league_id
                WHERE t.id = ANY(v_fav_teams)
           )
         ORDER BY cr.member_count DESC NULLS LAST, cr.created_at DESC
         LIMIT 12;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_fan_groups(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
