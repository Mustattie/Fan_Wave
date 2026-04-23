-- Migration 021: clips storage bucket for user-posted video clips.
--
-- The clips tab reads from media_clips but there was no place to upload the
-- video blobs. This creates a 'clips' storage bucket with:
--   - Public read (clips are browsable from the feed)
--   - Authenticated write, scoped to `<user_id>/...` — users cannot write to
--     other users' folders
--   - Authenticated delete, also scoped to their own folder
--
-- 50MB upload cap per file — enough for ~30s 1080p video, keeps egress sane.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clips',
  'clips',
  true,
  52428800,
  ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Read: anyone (public bucket already allows this; policy makes it explicit)
CREATE POLICY "clips_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'clips');

-- Write: only the owner can upload to their own folder
CREATE POLICY "clips_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update: only the owner
CREATE POLICY "clips_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: only the owner
CREATE POLICY "clips_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
