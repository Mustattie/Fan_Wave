-- 098: parties pinned to a fallback constant in Chicago.
--
-- WHY:
--   Reported from iOS UAT 2026-09-09 (BUG-13). A host used "Enter venue
--   manually", typed "QA Test Bar" / "2500 Victory Ave, Dallas", and did not
--   tap the autocomplete suggestion that appeared. selectedManualCoords was
--   therefore still null at insert time, and create-watch-party.tsx read:
--
--       venue_lat: manualEntry ? (selectedManualCoords?.lat ?? DEFAULT_LAT)
--       venue_lon: manualEntry ? (selectedManualCoords?.lon ?? DEFAULT_LON)
--
--   DEFAULT_LAT/DEFAULT_LON are the Chicago constants declared at the top of
--   that file as an initial map centre. So the party was written at
--   41.8781 / -87.6298 -- downtown Chicago -- with venue_city 'Dallas' and a
--   Dallas street address. The detail screen looked perfect, because it
--   renders the name and the address and never the coordinates. Every
--   distance-ranked surface, though, placed this party 800 miles from the
--   people it was for.
--
--   The client no longer has this path: it geocodes the typed address at
--   create time and refuses to continue if that fails, rather than
--   substituting a constant. This migration repairs what was already
--   written.
--
-- SCOPE:
--   Exactly one row on prod matches the default coordinate pair, verified
--   before writing this migration:
--
--       e9368715-a4e5-4284-abfc-a360e85eedfa
--       "Watch Party at QA Test Bar", 2500 Victory Ave, Dallas
--
--   No real user's party is affected. The replacement coordinate is the
--   Nominatim geocode of that party's own stored address (American Airlines
--   Center, 2500 Victory Avenue, Dallas TX): 32.7904894 / -96.8102830.
--   Geocoding cannot run inside Postgres, hence the literal.
--
-- SAFETY:
--   * The WHERE clause requires BOTH the exact default pair and the
--     matching id, so replaying this cannot move a party that has since
--     been corrected, and cannot touch any other row.
--   * A genuine Chicago venue is not at risk: the coordinates would have to
--     match the constant to 4+ decimal places, and any party created through
--     the Places picker carries the venue's own coordinates.

DO $$
DECLARE
  v_updated INT;
  v_others  INT;
BEGIN
  UPDATE public.watch_parties
  SET venue_lat = 32.7904894,
      venue_lon = -96.8102830
  WHERE id = 'e9368715-a4e5-4284-abfc-a360e85eedfa'
    AND venue_lat = 41.8781
    AND venue_lon = -87.6298;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '098: repaired % party/parties pinned to the Chicago default.', v_updated;

  -- Anything else still sitting on the constant is a party created before
  -- the client fix landed and NOT covered by the id above. Name it rather
  -- than guessing at a coordinate we have no address-derived answer for.
  SELECT count(*) INTO v_others
  FROM public.watch_parties
  WHERE venue_lat = 41.8781 AND venue_lon = -87.6298;

  IF v_others > 0 THEN
    RAISE WARNING '098: % further party/parties remain at the default coordinate and need a manual geocode. Query: SELECT id, title, venue_address FROM watch_parties WHERE venue_lat = 41.8781 AND venue_lon = -87.6298;', v_others;
  END IF;
END $$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   SELECT id, title, venue_city, venue_lat, venue_lon
--   FROM watch_parties
--   WHERE id = 'e9368715-a4e5-4284-abfc-a360e85eedfa';
--   -- expect: 32.7904894 / -96.8102830
--
--   SELECT count(*) FROM watch_parties
--   WHERE venue_lat = 41.8781 AND venue_lon = -87.6298;
--   -- expect: 0
