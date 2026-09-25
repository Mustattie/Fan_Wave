-- 104: concurrency-safe notification queue claiming, reaper, retention (P2.11, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Pair with the prepared change to
-- supabase/functions/process-notification-queue (uses the RPC below) --
-- apply this migration FIRST, then deploy the function. Until the
-- function is deployed the old select-then-update path keeps working;
-- claimed_at simply stays NULL.
--
-- Findings (audit of HEAD 7abeaa9):
--   * process-notification-queue claimed with SELECT ... LIMIT 100 followed
--     by UPDATE status='sending'. pg_cron fires it every minute via
--     pg_net without waiting, so two invocations can select the same rows
--     before either marks them -> the same push sent twice.
--   * A row marked 'sending' whose worker died (or whose 'sent' update
--     failed) was never re-selected: stranded forever, invisible to the
--     health check (which counts pending/failed only).
--   * 'sent' rows were never purged (the 018 cleanup cron is commented
--     out) -> unbounded growth.
--   * notification_log dedupes producers with read-then-insert on a
--     non-unique index -> a cron overlap can enqueue the same
--     notification twice.

-- 1. Lease column ----------------------------------------------------------
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_nq_sending_claimed
  ON public.notification_queue (claimed_at)
  WHERE status = 'sending';

-- 2. Atomic claim with reaper -----------------------------------------------
-- Returns the rows this caller now owns. Two concurrent callers get
-- disjoint sets (FOR UPDATE SKIP LOCKED). Rows stuck in 'sending' for
-- more than 5 minutes are handed back first: retried while attempts
-- remain, dead-lettered otherwise.
CREATE OR REPLACE FUNCTION public.claim_notification_batch(p_limit INT DEFAULT 100)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reaper.
  UPDATE public.notification_queue
  SET status        = CASE WHEN retry_count + 1 >= max_retries THEN 'dead' ELSE 'failed' END,
      retry_count   = retry_count + 1,
      next_retry_at = now(),
      error_message = COALESCE(error_message, '') || ' [reaped: sending > 5 min]',
      claimed_at    = NULL,
      updated_at    = now()
  WHERE status = 'sending'
    AND claimed_at IS NOT NULL
    AND claimed_at < now() - interval '5 minutes';

  -- Claim.
  RETURN QUERY
  UPDATE public.notification_queue q
  SET status     = 'sending',
      claimed_at = now(),
      updated_at = now()
  FROM (
    SELECT id
    FROM public.notification_queue
    WHERE status = 'pending'
       OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= now()))
    ORDER BY created_at
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    FOR UPDATE SKIP LOCKED
  ) s
  WHERE q.id = s.id
  RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_batch(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_notification_batch(INT) TO service_role;

COMMENT ON FUNCTION public.claim_notification_batch(INT) IS
  'Worker claim for process-notification-queue: reaps sending rows older than 5 min, then claims up to p_limit due rows with FOR UPDATE SKIP LOCKED. service_role only. Mig 104.';

-- 3. Retention ------------------------------------------------------------
-- sent > 7 days, dead > 30 days. Guarded so a replay does not double-schedule.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-notification-queue') THEN
    PERFORM cron.schedule(
      'purge-notification-queue',
      '17 3 * * *',
      $cron$
        DELETE FROM public.notification_queue
        WHERE (status = 'sent' AND sent_at    < now() - interval '7 days')
           OR (status = 'dead' AND updated_at < now() - interval '30 days');
      $cron$
    );
  END IF;
END $$;

-- 4. Producer dedupe -------------------------------------------------------
-- PRE-CHECK before applying (must return zero rows):
--   SELECT ref_id, type, count(*) FROM public.notification_log GROUP BY 1,2 HAVING count(*) > 1;
-- If it returns rows, run the DELETE below first (keeps the oldest).
--   DELETE FROM public.notification_log l USING public.notification_log k
--   WHERE l.ref_id = k.ref_id AND l.type = k.type AND l.created_at > k.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_ref_type_key
  ON public.notification_log (ref_id, type);
-- Producers (trigger-notifications) should insert with ON CONFLICT DO NOTHING
-- / upsert ignoreDuplicates once this exists; until then a race surfaces as
-- a 23505 on the second writer, which is the correct outcome (one push).

-- Reversal:
--   DROP INDEX IF EXISTS public.notification_log_ref_type_key;
--   SELECT cron.unschedule('purge-notification-queue');
--   DROP FUNCTION IF EXISTS public.claim_notification_batch(INT);
--   DROP INDEX IF EXISTS public.idx_nq_sending_claimed;
--   ALTER TABLE public.notification_queue DROP COLUMN IF EXISTS claimed_at;
