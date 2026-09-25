-- 105: clips storage hardening and orphan ledger (P2.9, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Additive; reversal at the bottom.
--
-- Findings (audit of HEAD 7abeaa9):
--   * storage policy clips_owner_update (mig 021) has USING but no WITH
--     CHECK, so an owner could rename an object INTO another user's folder
--     in one UPDATE. Every other ownership policy has both.
--   * Object deletion is client-side only (deleteClipAssets after the row
--     delete). A crash between the two, an account deletion
--     (delete_my_account removes rows only), or a server-side row delete
--     leaves the blob behind. Prod once carried 26 orphans / 304 MB
--     against 6 live clips.
--
-- Decision on public delivery: the bucket stays PUBLIC. Clips are a public
-- feed by product definition; signed URLs would break the CDN cache
-- (unique URL per viewer) and add a round-trip per card. The one
-- exception worth a follow-up is chat media under clips/<uid>/chat/…,
-- which is world-readable by URL today; moving that prefix to a private
-- bucket with signed URLs is a separate, product-owned change.
--
-- Changes:
--   1. WITH CHECK on clips_owner_update.
--   2. storage_gc ledger: an AFTER DELETE trigger on media_clips records
--      the object paths that should no longer exist. Nothing here deletes
--      objects (that needs the service role via the Storage API); the
--      ledger makes orphans countable by the health check and drainable
--      by an edge function or a manual sweep. Rows are removed by whoever
--      deletes the object.

-- 1. Ownership must hold after the update too ------------------------------
DROP POLICY IF EXISTS "clips_owner_update" ON storage.objects;
CREATE POLICY "clips_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2. Orphan ledger ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_gc (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   TEXT NOT NULL DEFAULT 'clips',
  object_path TEXT NOT NULL,
  source      TEXT NOT NULL,          -- 'media_clips_delete'
  ref_id      UUID,                   -- the deleted media_clips.id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, object_path)
);
ALTER TABLE public.storage_gc ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only.

-- Path inside the bucket from a public URL:
--   https://<ref>.supabase.co/storage/v1/object/public/clips/<uid>/<file>
--   -> <uid>/<file>
CREATE OR REPLACE FUNCTION public.storage_path_from_public_url(p_url TEXT, p_bucket TEXT DEFAULT 'clips')
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_url IS NULL THEN NULL
    WHEN position('/storage/v1/object/public/' || p_bucket || '/' IN p_url) > 0
      THEN split_part(p_url, '/storage/v1/object/public/' || p_bucket || '/', 2)
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.record_clip_assets_for_gc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path TEXT;
BEGIN
  FOREACH v_path IN ARRAY ARRAY[
    public.storage_path_from_public_url(OLD.media_url),
    public.storage_path_from_public_url(OLD.thumbnail_url)
  ] LOOP
    IF v_path IS NOT NULL AND v_path <> '' THEN
      INSERT INTO public.storage_gc (bucket_id, object_path, source, ref_id)
      VALUES ('clips', v_path, 'media_clips_delete', OLD.id)
      ON CONFLICT (bucket_id, object_path) DO NOTHING;
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_media_clips_gc ON public.media_clips;
CREATE TRIGGER trg_media_clips_gc
  AFTER DELETE ON public.media_clips
  FOR EACH ROW EXECUTE FUNCTION public.record_clip_assets_for_gc();

-- Ops query (service role): objects the ledger says should be gone but still exist.
--   SELECT g.object_path FROM public.storage_gc g
--   JOIN storage.objects o ON o.bucket_id = g.bucket_id AND o.name = g.object_path;
-- And the reverse audit (blobs no row references):
--   SELECT o.name FROM storage.objects o
--   WHERE o.bucket_id = 'clips'
--     AND NOT EXISTS (SELECT 1 FROM public.media_clips m
--                     WHERE m.media_url LIKE '%' || o.name OR m.thumbnail_url LIKE '%' || o.name);

-- Reversal:
--   DROP TRIGGER IF EXISTS trg_media_clips_gc ON public.media_clips;
--   DROP FUNCTION IF EXISTS public.record_clip_assets_for_gc();
--   DROP FUNCTION IF EXISTS public.storage_path_from_public_url(TEXT, TEXT);
--   DROP TABLE IF EXISTS public.storage_gc;
--   -- and re-create clips_owner_update without WITH CHECK (mig 021) if required.
