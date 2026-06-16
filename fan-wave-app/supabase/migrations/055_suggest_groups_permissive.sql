-- 055: Make suggest_fan_groups discover newly-created public groups.
--
-- WHY:
--   The reviewer (and any tester) created "Mavs Frisco fans" as a public
--   Team Fan Group. Other testers expected to see it under Groups tab →
--   Suggested Groups. But suggest_fan_groups returned empty because:
--     1. Section 1 requires a matching row in user_team_follows. New users
--        who haven't gone through team-follow onboarding (or legacy users
--        whose data sits in users.favorite_team_ids only) miss this.
--     2. Section 2 derives sport interest from user_team_follows + leagues.
--        Same problem — empty for users without follow rows.
--     3. There was no "any public group in my city" fallback when the
--        user has no team/sport interest signals at all.
--
-- WHAT:
--   • Section 1 now matches team_id against user_team_follows OR
--     users.favorite_team_ids (the denormalized array surface).
--   • Section 2 derives sport interest from BOTH follow surfaces.
--   • New Section 4 — generic city fallback: any public sports group in
--     the user's home_city that the user does not already own or belong
--     to. Capped at 12, ordered by member_count.
--   • All sections exclude groups owned by or already joined by the
--     caller so the list shows actionable suggestions only.

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
    -- ---------- user context ----------
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

    -- ---------- 1. followed-team groups (now reads BOTH surfaces) ----------
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

    -- ---------- 2. city-sport groups ----------
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
               -- Sport interest derived from BOTH surfaces.
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
           -- Exclude anything from Section 1 (team match wins).
           AND cr.team_id NOT IN (
             SELECT utf3.team_id FROM public.user_team_follows utf3
              WHERE utf3.user_id = p_user_auth_id
             UNION
             SELECT unnest(v_fav_teams)
           )
         ORDER BY cr.id, cr.member_count DESC NULLS LAST
         LIMIT 12;
    END IF;

    -- ---------- 3. World Cup country group ----------
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

    -- ---------- 4. Generic city fallback ----------
    -- Any public sports group in the user's home city that they don't
    -- already own / belong to. Ensures the Suggested feed is never empty
    -- for a user in a city that has at least one fan group, regardless
    -- of whether they've followed teams or picked sports yet.
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
         ORDER BY cr.member_count DESC NULLS LAST, cr.created_at DESC
         LIMIT 12;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_fan_groups(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
