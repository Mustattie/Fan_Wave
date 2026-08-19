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
