-- ============================================================================
-- 027_input_length_constraints.sql
--
-- Defence-in-depth length limits on user-supplied text fields. The mobile
-- clients enforce maxLength on TextInputs; these CHECK constraints stop a
-- malicious or buggy client from inserting unbounded text and bloating
-- storage / payloads.
--
-- Limits match the client-side caps:
--   watch_parties.title         200
--   watch_parties.description   2000
--   watch_parties.venue_name    200
--   watch_parties.venue_address 500
--   media_clips.title           120
--   media_clips.description     500
--   messages.content            2000
--   content_flags.details       1000
-- ============================================================================

DO $$
BEGIN
    -- watch_parties
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_parties_title_len_chk') THEN
        ALTER TABLE watch_parties
            ADD CONSTRAINT watch_parties_title_len_chk CHECK (length(title) <= 200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_parties_description_len_chk') THEN
        ALTER TABLE watch_parties
            ADD CONSTRAINT watch_parties_description_len_chk CHECK (description IS NULL OR length(description) <= 2000);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_parties_venue_name_len_chk') THEN
        ALTER TABLE watch_parties
            ADD CONSTRAINT watch_parties_venue_name_len_chk CHECK (venue_name IS NULL OR length(venue_name) <= 200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watch_parties_venue_address_len_chk') THEN
        ALTER TABLE watch_parties
            ADD CONSTRAINT watch_parties_venue_address_len_chk CHECK (venue_address IS NULL OR length(venue_address) <= 500);
    END IF;

    -- media_clips
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_clips_title_len_chk') THEN
        ALTER TABLE media_clips
            ADD CONSTRAINT media_clips_title_len_chk CHECK (length(title) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_clips_description_len_chk') THEN
        ALTER TABLE media_clips
            ADD CONSTRAINT media_clips_description_len_chk CHECK (description IS NULL OR length(description) <= 500);
    END IF;

    -- messages
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_len_chk') THEN
        ALTER TABLE messages
            ADD CONSTRAINT messages_content_len_chk CHECK (length(content) <= 2000);
    END IF;

    -- content_flags (free-form report details)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'content_flags' AND column_name = 'details')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_flags_details_len_chk') THEN
        ALTER TABLE content_flags
            ADD CONSTRAINT content_flags_details_len_chk CHECK (details IS NULL OR length(details) <= 1000);
    END IF;
END $$;
