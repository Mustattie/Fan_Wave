-- 086: get_public_profiles — batch display-name lookup for feed surfaces.
--
-- v9.4.3 UAT Round 4.
--
-- WHY:
--   Every card in the Clips feed rendered "@unknown · Fan Sphere · Jul 31",
--   including the viewer's OWN clips.
--
--   mapClipToDisplay (lib/mappers.ts) reads row.user.display_name, but no
--   caller ever supplied it:
--     * For You / Trending do  .from('media_clips').select('*')  and
--       media_clips.user_id is a bare UUID with no FK to users (mig 002),
--       so there is no relationship for PostgREST to embed even if the
--       select asked for one.
--     * Following calls get_following_clips (mig 080), which is
--       RETURNS SETOF public.media_clips -- same columns, same gap.
--
--   And a client-side join could not fix it either: the only SELECT policy
--   on users is "Users read own profile" (mig 001) -- auth_id = auth.uid().
--   Reading any other fan's display name from the client is impossible by
--   design, so this has to be a SECURITY DEFINER accessor.
--
-- WHAT:
--   get_public_profiles(p_user_ids UUID[]) -> (user_id, display_name,
--   avatar_url). One round trip for a whole page of clips, mirroring how
--   the feed already batches its follow-state lookup.
--
-- SAFETY:
--   * Returns ONLY the three fields already public elsewhere in the app --
--     get_followers / get_following (mig 011) expose exactly these plus
--     follower_count. No email, no phone, no home_city, no tier.
--   * Requires an authenticated caller; anon gets no grant. An anonymous
--     feed reader simply keeps the '@unknown' fallback.
--   * Input is capped at 200 ids so the RPC cannot be used to enumerate
--     the whole users table in one call.
--   * SECURITY DEFINER + explicit search_path, matching migrations
--     017/032/051/053/082/084.

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_user_ids UUID[])
RETURNS TABLE (
  user_id      UUID,
  display_name TEXT,
  avatar_url   TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.auth_id, u.display_name, u.avatar_url
  FROM public.users u
  WHERE u.auth_id = ANY(p_user_ids[1:200]);
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profiles(UUID[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_profiles(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.get_public_profiles(UUID[]) IS
  'Batch (display_name, avatar_url) by auth_id for feed surfaces. Exists because users RLS is own-profile-only (mig 001) and media_clips.user_id has no FK to embed. Capped at 200 ids. See migration 086.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Your own id resolves:
--   SELECT * FROM get_public_profiles(ARRAY[auth.uid()]);
--
--   -- A clip page resolves every poster (no rows missing => no '@unknown'):
--   SELECT count(*) FROM get_public_profiles(
--     ARRAY(SELECT DISTINCT user_id FROM media_clips ORDER BY 1 LIMIT 20)
--   );
