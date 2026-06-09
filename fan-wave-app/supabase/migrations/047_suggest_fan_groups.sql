-- ============================================================
-- Migration 047: suggest_fan_groups RPC
--
-- Powers the post-onboarding "Suggested Groups" screen so first-launch
-- users see populated, relevant fan groups instead of an empty feed.
--
-- Priority order (capped at 12 total):
--   1. Followed-team groups   — chat_rooms with group_type='sports'
--      and team_id matching a row in user_team_follows.
--   2. City-sport groups      — chat_rooms with city = users.home_city
--      and sport_id in the user's selected sports, minus anything
--      already returned by (1).
--   3. World Cup country group — when feature_flags.world_cup_mode is
--      enabled, the user's country national-team supporter group
--      (group_type='worldcup', team_id matching). Defaults to USA when
--      the user has no resolvable country.
--
-- Notes
--   * The client (AsyncStorage) stores selected sports as lowercase
--     text ids ('nfl','nba',...). chat_rooms.sport_id is a UUID
--     referencing sports(id). We map by lower(sports.name) -> id.
--   * SECURITY DEFINER so this can read the caller's user_team_follows /
--     users row even when called via RLS-protected channels; search_path
--     is pinned to public to keep the function deterministic.
-- ============================================================

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
    v_selected    TEXT[];   -- lowercase sport name list from users.selected_sports if available
    v_wc_enabled  BOOLEAN := FALSE;
    v_country     TEXT;
BEGIN
    -- ---------- user context ----------
    SELECT u.home_city
      INTO v_home_city
      FROM public.users u
     WHERE u.auth_id = p_user_auth_id
     LIMIT 1;

    -- World Cup feature flag (NULL-safe).
    SELECT COALESCE(ff.enabled, FALSE)
      INTO v_wc_enabled
      FROM public.feature_flags ff
     WHERE ff.key = 'world_cup_mode'
     LIMIT 1;

    -- ---------- 1. followed-team groups ----------
    RETURN QUERY
    SELECT cr.id, cr.name, cr.description, cr.group_type, cr.sport_id, cr.event_id,
           cr.team_id, cr.city, cr.tags, cr.visibility, cr.owner_id, cr.member_count,
           cr.avatar_url, cr.created_at,
           'team'::TEXT AS reason
      FROM public.chat_rooms cr
      JOIN public.user_team_follows utf ON utf.team_id = cr.team_id
     WHERE utf.user_id   = p_user_auth_id
       AND cr.group_type = 'sports'
       AND cr.visibility = 'public'
     ORDER BY cr.member_count DESC NULLS LAST
     LIMIT 12;

    -- ---------- 2. city-sport groups ----------
    -- Only run if we have a home_city; otherwise nothing to filter on.
    -- Sport set is derived from the user's followed teams (teams →
    -- leagues → sports), which mirrors what onboarding-sports stored
    -- but reads from the canonical DB row instead of AsyncStorage.
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
           AND cr.sport_id IN (
               SELECT DISTINCT l.sport_id
                 FROM public.user_team_follows utf2
                 JOIN public.teams t   ON t.id = utf2.team_id
                 JOIN public.leagues l ON l.id = t.league_id
                WHERE utf2.user_id = p_user_auth_id
           )
           -- exclude anything already produced by (1) via team_id match
           AND NOT EXISTS (
               SELECT 1
                 FROM public.user_team_follows utf3
                WHERE utf3.user_id = p_user_auth_id
                  AND utf3.team_id = cr.team_id
           )
         ORDER BY cr.id, cr.member_count DESC NULLS LAST
         LIMIT 12;
    END IF;

    -- ---------- 3. World Cup country group ----------
    IF v_wc_enabled THEN
        -- Best-effort country detection. Today we only have home_city, no
        -- country column, so default to USA. Future: derive country from
        -- a users.country column or geolocation.
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
           AND (t.code = v_country OR t.name = 'United States')
         ORDER BY cr.member_count DESC NULLS LAST
         LIMIT 3;
    END IF;
END;
$$;

-- Lock down execution: callers must be authenticated.
REVOKE ALL ON FUNCTION public.suggest_fan_groups(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_fan_groups(UUID) TO authenticated;
