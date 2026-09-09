-- 096: parties whose venue is a town.
--
-- WHY:
--   Reported from iOS UAT 2026-09-09 (BUG-2 / BUG-3). Searching "Prosper Tx"
--   in Create Watch Party returned one result:
--
--       Prosper -- Prosper, TX, USA -- Bar -- 1.0 mi away
--
--   That is the municipality of Prosper, returned by Google Places Text
--   Search as a `locality`, wearing a Bar badge because the venue-search
--   edge function had no establishment filter and classify() defaulted any
--   unrecognised type to 'bar'. It was selectable, and the wizard carried it
--   all the way through:
--
--       venue_name    = 'Prosper'
--       venue_address = 'Prosper, TX, USA'
--       venue_city    = 'Prosper'      (cityFromAddress of the above)
--
--   So the watch party detail screen reads "Prosper / Prosper, TX, USA" with
--   a meta line of "Prosper . Prosper", and every attendee is told to meet
--   at a town of 30,000 people. This is bad data we wrote, not bad data a
--   host typed -- the picker offered it as a venue.
--
--   The source defect is fixed in the edge function (geographic types are
--   dropped, unclassifiable establishments become 'venue' rather than
--   'bar') and on the client (no type defaulting). That stops new rows.
--   This migration deals with the ones already written.
--
-- WHAT:
--   Identify rows where the venue is indistinguishable from its own city
--   and carries no street address, then replace the venue name with the
--   fallback the detail screen already uses for a missing venue --
--   'Venue TBD'. The address and city are left intact, so an attendee still
--   learns the town; they are simply no longer told a bar exists there.
--
--   The original values are copied to watch_parties_venue_backup_096 first,
--   so this is reversible and nothing a host entered is destroyed.
--
-- THE PREDICATE:
--   Both halves are required.
--
--     lower(venue_name) = lower(venue_city)
--       A locality result names itself and its own city identically. A real
--       venue almost never does -- "Prosper Ale House" in Prosper differs.
--
--     venue_address contains no digit
--       This is the half that makes it safe. Google's formattedAddress for
--       any US establishment carries a street number and a ZIP code
--       ("301 N Custer Rd #180, McKinney, TX 75071"). A locality's is bare
--       ("Prosper, TX, USA"). So a genuine bar that happens to share its
--       town's name is excluded by its own address.
--
--   Manual-entry rows are covered by the same test and the same logic: a
--   host who typed a venue name equal to the city with no street number has
--   given us nothing an attendee can navigate to either.

CREATE TABLE IF NOT EXISTS public.watch_parties_venue_backup_096 (
  watch_party_id UUID PRIMARY KEY,
  venue_name     TEXT,
  venue_address  TEXT,
  venue_city     TEXT,
  backed_up_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.watch_parties_venue_backup_096 IS
  'Pre-correction venue fields for parties whose venue was a geographic place rather than an establishment (migration 096). Restore with: UPDATE watch_parties w SET venue_name = b.venue_name FROM watch_parties_venue_backup_096 b WHERE b.watch_party_id = w.id;';

DO $$
DECLARE
  v_count INT;
  v_row   RECORD;
BEGIN
  CREATE TEMP TABLE _city_as_venue ON COMMIT DROP AS
  SELECT id, venue_name, venue_address, venue_city, title, starts_at
  FROM public.watch_parties
  WHERE venue_name IS NOT NULL
    AND venue_city IS NOT NULL
    AND btrim(lower(venue_name)) = btrim(lower(venue_city))
    AND btrim(venue_name) <> ''
    AND COALESCE(venue_address, '') !~ '[0-9]';

  SELECT count(*) INTO v_count FROM _city_as_venue;

  IF v_count = 0 THEN
    RAISE NOTICE '096: no city-as-venue parties found. Nothing to correct.';
    RETURN;
  END IF;

  -- Name them in the log. These are real parties with real hosts, and
  -- whoever runs this migration should be able to follow up out of band.
  FOR v_row IN SELECT * FROM _city_as_venue ORDER BY starts_at DESC LOOP
    RAISE NOTICE '096: correcting % | "%" | venue "%" / city "%" | starts %',
      v_row.id, v_row.title, v_row.venue_name, v_row.venue_city, v_row.starts_at;
  END LOOP;

  INSERT INTO public.watch_parties_venue_backup_096
    (watch_party_id, venue_name, venue_address, venue_city)
  SELECT id, venue_name, venue_address, venue_city FROM _city_as_venue
  ON CONFLICT (watch_party_id) DO NOTHING;

  UPDATE public.watch_parties w
  SET venue_name = 'Venue TBD'
  FROM _city_as_venue c
  WHERE w.id = c.id;

  RAISE NOTICE '096: corrected % party/parties; originals in watch_parties_venue_backup_096.', v_count;
END $$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Nothing should match the predicate any more:
--   SELECT id, title, venue_name, venue_city, venue_address
--   FROM watch_parties
--   WHERE btrim(lower(venue_name)) = btrim(lower(venue_city))
--     AND COALESCE(venue_address, '') !~ '[0-9]';
--   -- expect: 0 rows
--
--   -- What was changed, and what it was before:
--   SELECT b.*, w.venue_name AS venue_name_now
--   FROM watch_parties_venue_backup_096 b
--   JOIN watch_parties w ON w.id = b.watch_party_id;
--
--   -- The party named in the UAT report:
--   SELECT id, title, venue_name, venue_address, venue_city
--   FROM watch_parties
--   WHERE title ILIKE '%Indiana Hoosiers%North Texas%';
