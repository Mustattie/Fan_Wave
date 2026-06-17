-- 057: Create avatars storage bucket + scoped RLS policies.
--
-- Why: v8.1 commit 384ff66 fixed the avatar UPLOAD PATH on the client
-- (`${userId}/avatar.${ext}` so `upsert: true` actually overwrites).
-- But the storage bucket itself was never created on the prod project
-- (fwlfiejvxmslkpoojggs), so every avatar save fails with the alert
-- "Could not save profile: Bucket not found".
--
-- This migration adds the bucket with:
--   * public read (so unsigned profile-pic URLs work)
--   * 5 MB upload cap (avatars don't need more; protects against abuse)
--   * jpeg/png/webp MIME allowlist
--   * Scoped INSERT/UPDATE/DELETE policies that only let authenticated
--     users touch files under their own auth.uid()/* folder. The first
--     path segment must equal the caller's uid as text, matching the
--     stable per-user path the v8.1 client now uses.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── RLS on storage.objects for the avatars bucket ────────────────

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

-- Verify:
--   SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'avatars';
--   SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'avatars_%';
