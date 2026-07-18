-- 072: Add media columns to messages for WhatsApp-style unified chat feed
--
-- WHY:
--   v9.1 UAT 2026-07-18 (repeated): "having Chat and Highlights maybe
--   confusing, lets just have a chat like WhatsApp where users can all
--   chat and post videos on the same channel."
--
--   Prior model: text lived in `messages`, image/video "moments" lived in
--   `match_moments` accessed through a separate Highlights tab in
--   app/fan-group/[id].tsx. This migration lets `messages` carry media
--   inline, so the client can merge both tables (or, eventually, retire
--   match_moments entirely) into a single WhatsApp-like feed.
--
-- WHAT this changes (idempotent):
--   1. messages gains: media_url, thumbnail_url, media_type,
--      duration_seconds, clip_id (nullable FK to media_clips for the case
--      where a chat post is dual-written to the global Clips feed).
--   2. Widens messages.type CHECK to include 'clip'.
--
-- What this migration does NOT do:
--   * No data migration from match_moments → messages. Existing moments
--     stay in place; the client merges the two on read. A later slice can
--     backfill if we decide to fully deprecate match_moments.
--   * No RPC. Client posts to messages directly (RLS from mig 053 already
--     allows chat_room_members to INSERT rows).

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url        TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url    TEXT,
  ADD COLUMN IF NOT EXISTS media_type       TEXT
    CHECK (media_type IS NULL OR media_type IN ('video','image')),
  ADD COLUMN IF NOT EXISTS duration_seconds INT,
  ADD COLUMN IF NOT EXISTS clip_id          UUID REFERENCES public.media_clips(id) ON DELETE SET NULL;

-- Widen the type enum. Drop-and-re-add is the safe pattern in Postgres
-- (mig 067 used the same). Preserve the pre-existing check values.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD  CONSTRAINT messages_type_check
  CHECK (type IN ('text','image','video','moment','clip'));

-- Index the created_at DESC used by the paginated feed reader; multi-column
-- index against chat_room_id lets the reader scan a single room efficiently.
CREATE INDEX IF NOT EXISTS idx_messages_room_created_desc
  ON public.messages (chat_room_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='messages'
--       AND column_name IN ('media_url','thumbnail_url','media_type','duration_seconds','clip_id');
