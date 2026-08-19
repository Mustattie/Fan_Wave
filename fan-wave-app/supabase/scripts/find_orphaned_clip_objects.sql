-- Orphaned objects in the `clips` storage bucket.
--
-- v9.4.4. Run this, then hand the `name` column to:
--   npx supabase storage rm "ss:///clips/<name>" --linked --experimental
--
-- WHY THIS EXISTS:
--   Storage leaked on two paths (both fixed in v9.4.4, see lib/storage.ts
--   deleteClipAssets) and prod accumulated 156 MB of unreferenced blobs:
--     1. Deleting a clip removed the media_clips row but never the object.
--     2. clipUploads uploaded first, then inserted; a failed insert left the
--        blob behind, and a retry uploaded a second copy.
--   New leaks should not appear. Run this occasionally to confirm that, and
--   to sweep anything left from before the fix.
--
-- READ THIS BEFORE DELETING ANYTHING:
--   The `clips` bucket is NOT only used by media_clips. It also backs
--   match_moments.media_url and messages.media_url / thumbnail_url -- the
--   `<uid>/moments/...` paths in particular are Moments, not clips. Checking
--   media_clips alone reports 26 orphans when the real number is 10; the
--   other 16 are live Moments and chat media. Every column below must stay
--   in the refs CTE. If a new table starts storing into this bucket, add it
--   here FIRST.

WITH refs AS (
  SELECT media_url     AS u FROM public.media_clips   WHERE media_url     IS NOT NULL
  UNION ALL SELECT thumbnail_url FROM public.media_clips   WHERE thumbnail_url IS NOT NULL
  UNION ALL SELECT media_url     FROM public.match_moments WHERE media_url     IS NOT NULL
  UNION ALL SELECT media_url     FROM public.messages      WHERE media_url     IS NOT NULL
  UNION ALL SELECT thumbnail_url FROM public.messages      WHERE thumbnail_url IS NOT NULL
  UNION ALL SELECT avatar_url    FROM public.users         WHERE avatar_url    IS NOT NULL
  UNION ALL SELECT avatar_url    FROM public.chat_rooms    WHERE avatar_url    IS NOT NULL
)
SELECT o.name,
       pg_size_pretty((o.metadata->>'size')::bigint) AS size,
       (o.metadata->>'mimetype')                     AS mime,
       o.created_at::date                            AS created
  FROM storage.objects o
 WHERE o.bucket_id = 'clips'
   AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.u LIKE '%' || o.name)
 ORDER BY (o.metadata->>'size')::bigint DESC;

-- Totals, to sanity-check the split before removing anything:
--
--   WITH refs AS ( ...as above... )
--   SELECT CASE WHEN EXISTS (SELECT 1 FROM refs r WHERE r.u LIKE '%' || o.name)
--               THEN 'REFERENCED' ELSE 'orphan' END AS state,
--          count(*), pg_size_pretty(sum((o.metadata->>'size')::bigint))
--     FROM storage.objects o WHERE o.bucket_id = 'clips' GROUP BY 1;
