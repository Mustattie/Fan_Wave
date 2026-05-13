-- ============================================================================
-- 025_fix_watch_party_details_view.sql
--
-- The watch_party_details view (created in 017) was missing an explicit
-- GRANT to the authenticated role and ran with security_definer semantics
-- (the default), which bypassed RLS on the underlying watch_parties table.
--
-- Recreate it with security_invoker so RLS is enforced through the view,
-- and grant SELECT to authenticated/anon. Reload PostgREST's schema cache
-- so the view is exposed via the REST API.
-- ============================================================================

CREATE OR REPLACE VIEW watch_party_details
WITH (security_invoker = true) AS
SELECT
    wp.*,
    s.name AS sport_name,
    u.display_name AS creator_name
FROM watch_parties wp
LEFT JOIN sports s ON s.id = wp.sport_id
LEFT JOIN users u ON u.auth_id = wp.creator_id;

GRANT SELECT ON watch_party_details TO authenticated, anon;

-- Nudge PostgREST to refresh its schema cache.
NOTIFY pgrst, 'reload schema';
