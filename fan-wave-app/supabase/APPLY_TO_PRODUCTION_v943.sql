-- =====================================================================
-- Fan Sphere v9.4.3 UAT Round 4 (continued) Hotfix Bundle
-- =====================================================================
-- Applies migrations 085..087 to prod (fwlfiejvxmslkpoojggs). These are
-- NEW migrations written after the v9.4.2 bundle was applied on
-- 2026-08-12 -- they are not a replay of anything in that file.
--
-- Symptoms from UAT round 4 that trace here:
--
--   * Watch Party detail listed five "1 fan from <X> also going" callouts
--     under a header correctly reading "1 going . 0 maybe . 0 can't go".
--     One person, counted once per chat room shared with the viewer -- and
--     four of those "fan groups" were per-game live chat rooms, which
--     get_or_create_game_chat auto-joins you into.
--       -> migration 085
--
--   * Every card in the Clips feed read "@unknown", the viewer's own clips
--     included. No caller ever supplied a display name, and users RLS is
--     own-profile-only so the client could not fetch one.
--       -> migration 086
--
--   * A watch party at "301 N Custer Rd #180, McKinney, TX 75071"
--     displayed as "Uncork'd Bar & Grill . Dallas" on the detail screen
--     and in the RSVP tab -- the creator's home city, not the venue's.
--       -> migration 087
--
-- ORDER OF OPERATIONS -- this file must be applied BEFORE the v9.4.3
-- build is installed:
--   * 085 and 086 change RPC signatures the new client calls. An old
--     client is unaffected (085 keeps its signature; 086 is new), so
--     applying early is safe.
--   * 087 adds watch_parties.venue_metro. The new client reads it, with a
--     fallback to the pre-087 query if it is missing -- but the fallback
--     costs a round trip, so apply first.
--
-- Every statement below is idempotent (IF NOT EXISTS / CREATE OR REPLACE /
-- guarded UPDATEs). Safe to re-run.
--
-- How to apply:
--   1. Supabase Studio -> SQL Editor
--   2. Paste the entire contents of this file
--   3. Run
--   4. Verify with the SELECT block at the bottom
-- =====================================================================



-- =====================================================================
-- 085_affinity_real_fan_groups_only.sql
-- =====================================================================
-- 085: Fan-group affinity counts only real fan groups, and reports the
--      number of DISTINCT fans rather than a per-room tally.
--
-- v9.4.3 UAT Round 4.
--
-- WHY (UAT screenshot, Watch Party detail):
--   A party with exactly ONE going RSVP rendered five separate callouts --
--   "🎉 1 fan from Chicago White Sox vs New York Yankees also going",
--   "🎉 1 fan from New York Yankees vs Atlanta Braves also going", ... --
--   under a header that correctly read "1/50 going · 0 maybe · 0 can't go".
--   Reads as six people. It is one person, counted once per chat room the
--   viewer happens to share with them.
--
--   Two causes, both fixed here:
--
--   1. Migration 084 filtered viewer rooms with only
--        cr.group_type IS DISTINCT FROM 'worldcup'
--      which lets group_type='game_chat' rooms through. Those are the
--      per-game live chat rooms from migration 067, and
--      get_or_create_game_chat auto-joins the caller -- so merely opening a
--      game's Live Chat enrolls you in a "group". Four of the five callouts
--      in the screenshot were game rooms; only one was a real fan group.
--
--      Fixed with an allow-list -- group_type IN ('sports','general') --
--      instead of a deny-list, so a future room type can't leak in the same
--      way. 'sports' is what create-group.tsx writes for every user-made fan
--      group; 'general' is the legacy value from migration 002.
--
--   2. The rows are inherently per-group, so one fan who shares two REAL
--      groups with the viewer still yields two rows. Adding distinct_fans
--      (the same value on every row, like 084's totals) lets the client
--      render one honest headline instead of stacking rows that read as a
--      sum.
--
-- SAFETY:
--   * DROP + CREATE, not CREATE OR REPLACE: the return type gains a column
--     and Postgres refuses to replace a function whose OUT columns changed.
--     The DROP is IF EXISTS and the signature is unchanged, so grants are
--     re-issued below and PostgREST is told to reload.
--   * Still SECURITY DEFINER + explicit search_path, matching 084.
--   * Viewer remains excluded from the counts (gm.user_id <> p_viewer_id).
--   * Purely a read path -- no data is rewritten by this migration.

DROP FUNCTION IF EXISTS public.get_watch_party_group_affinity(UUID, UUID);

CREATE FUNCTION public.get_watch_party_group_affinity(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  group_id UUID,
  group_name TEXT,
  going_count INT,
  distinct_fans INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Real fan groups the viewer belongs to. Allow-list on group_type keeps
  -- game_chat (mig 067) and worldcup (mig 006) rooms out.
  WITH viewer_groups AS (
    SELECT cr.id AS group_id, cr.name AS group_name
    FROM public.chat_room_members m
    JOIN public.chat_rooms cr ON cr.id = m.chat_room_id
    WHERE m.user_id = p_viewer_id
      AND cr.group_type IN ('sports', 'general')
  ),
  -- (group, fan) pairs: members of those groups who RSVP'd going, viewer
  -- excluded. DISTINCT so a user who somehow holds two membership rows in
  -- one room is not double counted.
  going_members AS (
    SELECT DISTINCT vg.group_id, vg.group_name, gm.user_id
    FROM viewer_groups vg
    JOIN public.chat_room_members gm ON gm.chat_room_id = vg.group_id
    JOIN public.watch_party_rsvps r  ON r.user_id = gm.user_id
    WHERE r.watch_party_id = p_party_id
      AND r.status = 'going'
      AND gm.user_id <> p_viewer_id
  ),
  -- How many real humans that is across ALL the viewer's groups. One fan
  -- in three shared groups counts once here, three times in going_count.
  overall AS (
    SELECT count(DISTINCT user_id)::INT AS distinct_fans FROM going_members
  )
  SELECT
    gm.group_id,
    gm.group_name,
    count(*)::INT AS going_count,
    o.distinct_fans
  FROM going_members gm
  CROSS JOIN overall o
  GROUP BY gm.group_id, gm.group_name, o.distinct_fans
  ORDER BY count(*) DESC, gm.group_name
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID) IS
  'Top 5 REAL fan groups (group_type sports/general -- never game_chat or worldcup) the viewer is in whose members RSVP''d going to this party, plus distinct_fans: the number of unique people that represents across all of them. See migration 085.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The screenshot case: one going RSVP, viewer sharing several game
--   -- chat rooms with them. Expect at most the real fan groups, and
--   -- distinct_fans = 1 on every row.
--   SELECT * FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>');
--
--   -- No game rooms may appear:
--   SELECT cr.group_type
--     FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>') a
--     JOIN chat_rooms cr ON cr.id = a.group_id;
--   -- expect: only 'sports' / 'general'
--
--   -- distinct_fans never exceeds the party's going total:
--   SELECT DISTINCT a.distinct_fans, t.total_going
--     FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>') a,
--          LATERAL (SELECT total_going FROM get_watch_party_attendees_v2(
--                     '<party-id>', '<viewer-uid>') LIMIT 1) t;


-- =====================================================================
-- 086_public_profiles_for_feeds.sql
-- =====================================================================
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


-- =====================================================================
-- 087_venue_city_truth_and_metro_anchor.sql
-- =====================================================================
-- 087: venue_city tells the truth; venue_metro carries the search anchor.
--
-- v9.4.3 UAT Round 4.
--
-- WHY:
--   A watch party at "301 N Custer Rd #180, McKinney, TX 75071, USA"
--   rendered as "Uncork'd Bar & Grill · Dallas" on the detail screen and in
--   the RSVP tab. create-watch-party was writing venue_city = the CREATOR's
--   home city, not the venue's.
--
--   The client fix alone would have broken discovery, because venue_city is
--   doing double duty: it is also the matching key for "Watch Parties Near
--   You" (hooks/useData.ts useWatchParties) and for Discover's local filter.
--   Both do `ilike(venue_city, <the viewer's home city>)`. Storing the true
--   "McKinney" would hide this party from every Dallas fan -- and anchoring
--   venue search on the metro is deliberate: a McKinney user wants the whole
--   Dallas-metro venue list (see the comment in create-watch-party.tsx).
--
--   So the two meanings get two columns:
--     venue_city   -- where the venue actually is.       DISPLAY.
--     venue_metro  -- the metro the party was filed under. MATCHING.
--
--   Every existing venue_city value IS the creator's home city, i.e. exactly
--   the metro anchor. Copying it across preserves today's matching results
--   row-for-row: no party changes which feeds it appears in.
--
-- WHAT:
--   1. venue_metro column + index.
--   2. Backfill venue_metro from venue_city (the anchor it always was).
--   3. Correct venue_city from venue_address, conservatively.
--
-- SAFETY:
--   * Step 3 only touches rows whose address ends in the Google Places shape
--     "..., <city>, <STATE> <ZIP>[, <country>]" -- the format the
--     venue-search edge function returns. Anything else is left alone rather
--     than guessed at. Mirrors lib/addressCity.ts, which has unit tests.
--   * Step 2 runs before step 3, so the anchor is captured before venue_city
--     is rewritten. Both inside one transaction.
--   * Additive column, nullable, no constraint -- an older client that does
--     not know about venue_metro keeps writing venue_city and still works
--     (the readers fall back to venue_city when venue_metro IS NULL).

BEGIN;

-- ─── 1. Column ─────────────────────────────────────────────────────
ALTER TABLE public.watch_parties
  ADD COLUMN IF NOT EXISTS venue_metro TEXT;

COMMENT ON COLUMN public.watch_parties.venue_metro IS
  'Metro the party is filed under for "near you" matching -- the creator''s home city. Distinct from venue_city, which is where the venue actually is. See migration 087.';

COMMENT ON COLUMN public.watch_parties.venue_city IS
  'City of the VENUE, parsed from venue_address. Display only -- match on venue_metro. See migration 087.';

CREATE INDEX IF NOT EXISTS idx_watch_parties_venue_metro
  ON public.watch_parties (venue_metro);

-- ─── 2. Backfill the anchor before venue_city is rewritten ─────────
UPDATE public.watch_parties
   SET venue_metro = venue_city
 WHERE venue_metro IS NULL
   AND venue_city IS NOT NULL;

-- ─── 3. Correct venue_city from the address ────────────────────────
-- Conservative: requires >= 3 comma segments (street, city, state+zip) and
-- a final segment that really looks like "TX 75071" / "Texas 75071" once an
-- optional trailing country is stripped. Rows that do not match keep the
-- value they have.
WITH parsed AS (
  SELECT
    wp.id,
    x.arr,
    array_length(x.arr, 1) AS n
  FROM public.watch_parties wp
  CROSS JOIN LATERAL (
    SELECT regexp_split_to_array(
             btrim(
               regexp_replace(
                 wp.venue_address,
                 ',\s*(USA|U\.S\.A\.|US|United States|Canada|Mexico|M[ée]xico)\s*$',
                 '',
                 'i'
               )
             ),
             '\s*,\s*'
           ) AS arr
  ) x
  WHERE wp.venue_address IS NOT NULL
    AND btrim(wp.venue_address) <> ''
)
UPDATE public.watch_parties wp
   SET venue_city = btrim(p.arr[p.n - 1])
  FROM parsed p
 WHERE wp.id = p.id
   AND p.n >= 3
   AND p.arr[p.n] ~ '^[A-Za-z][A-Za-z .]*\s+\d{5}(-\d{4})?$'
   AND btrim(p.arr[p.n - 1]) ~ '[A-Za-z]'
   AND wp.venue_city IS DISTINCT FROM btrim(p.arr[p.n - 1]);

COMMIT;

-- PostgREST caches the table's column list. Without this, venue_metro is
-- invisible to the API and the client's .or('venue_metro.ilike...') filter
-- fails until the cache happens to refresh.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The party from the UAT screenshot:
--   SELECT venue_name, venue_address, venue_city, venue_metro
--     FROM watch_parties
--    WHERE venue_address ILIKE '%Custer%';
--   -- expect: venue_city 'McKinney', venue_metro 'Dallas'
--
--   -- Nobody lost their anchor:
--   SELECT count(*) FROM watch_parties
--    WHERE venue_metro IS NULL AND venue_city IS NOT NULL;
--   -- expect: 0
--
--   -- What step 3 chose to leave alone (addresses it would not parse):
--   SELECT venue_city, venue_address FROM watch_parties
--    WHERE venue_address IS NOT NULL
--      AND venue_city IS NOT DISTINCT FROM venue_metro
--    ORDER BY created_at DESC LIMIT 20;

-- =======================================================================
-- Post-apply verification -- run these separately after applying above
-- =======================================================================
-- 1) All three RPCs present with the expected signatures. Note
--    get_watch_party_group_affinity must now show FOUR output columns
--    (group_id, group_name, going_count, distinct_fans) -- if it still
--    shows three, the DROP+CREATE in 085 did not run:
--   SELECT p.proname,
--          pg_get_function_identity_arguments(p.oid) AS args,
--          pg_get_function_result(p.oid)             AS returns
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('get_watch_party_group_affinity',
--                        'get_public_profiles')
--    ORDER BY 1;
--
-- 2) venue_metro exists and no party lost its anchor (expect 0):
--   SELECT count(*) FROM public.watch_parties
--    WHERE venue_metro IS NULL AND venue_city IS NOT NULL;
--
-- 3) The party from the UAT screenshot -- expect McKinney / Dallas:
--   SELECT venue_name, venue_address, venue_city, venue_metro
--     FROM public.watch_parties
--    WHERE venue_address ILIKE '%Custer%';
--
-- 4) Your own profile resolves through the new accessor (expect 1 row):
--   SELECT * FROM public.get_public_profiles(ARRAY[auth.uid()]);
--
-- 5) Sanity check on the 085 fix -- these are the memberships that used to
--    leak into the affinity callout. They should still exist (opening a
--    game's Live Chat legitimately joins you), they just must no longer
--    produce "N fans from <matchup> also going":
--   SELECT cr.name, cr.group_type
--     FROM public.chat_room_members m
--     JOIN public.chat_rooms cr ON cr.id = m.chat_room_id
--    WHERE m.user_id = auth.uid()
--      AND cr.group_type = 'game_chat';
--   -- then, for the same party from the screenshot, expect only real
--   -- fan groups back:
--   SELECT * FROM public.get_watch_party_group_affinity(
--     '<party-id>', auth.uid()
--   );
--
-- 6) Force a PostgREST schema-cache reload if the app still reports
--    "not found in schema cache" after the run:
--   NOTIFY pgrst, 'reload schema';
