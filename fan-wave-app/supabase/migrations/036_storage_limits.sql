-- 036: tighten the clips Storage bucket file_size_limit from 50 MB
-- (set in migration 021) down to 25 MB. Matches the client-side
-- validation in lib/storage.ts validateClip() and keeps egress
-- predictable during the WC traffic surge.

UPDATE storage.buckets
SET file_size_limit = 26214400  -- 25 MB
WHERE id = 'clips' AND file_size_limit > 26214400;
