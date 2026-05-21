-- 035: "Your trial ends tomorrow" push notification cron (FW-112).
-- Runs hourly; for each trial user whose premium_active_until is in the
-- next 23–25h window AND who hasn't already received their reminder,
-- enqueues a push via notification_queue (migration 018). Tracked via a
-- new trial_reminders_sent table for idempotency — guarantees one
-- reminder per trial lifecycle even if the cron fires twice or the
-- expiration window expands.

-- ─── 1. Idempotency ledger ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trial_reminders_sent (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  -- The original_transaction_id from the entitlement at the time the
  -- reminder was sent. Joining on this would dedup per-trial-instance
  -- if a user did multiple trials over time (Apple/Google generally
  -- prevent that, but defence in depth).
  original_transaction_id  TEXT,
  premium_active_until     TIMESTAMPTZ NOT NULL,
  sent_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trial_reminders_dedup
  ON trial_reminders_sent (user_id, premium_active_until);

ALTER TABLE trial_reminders_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY trial_reminders_sent_select_own ON trial_reminders_sent
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── 2. The function that does one pass ─────────────────────────────
-- Selects all trial users whose premium_active_until is in the next
-- 23–25h window. For each, INSERTs into notification_queue and records
-- the send in trial_reminders_sent. ON CONFLICT (user_id,
-- premium_active_until) DO NOTHING is the idempotency guard.

CREATE OR REPLACE FUNCTION public.run_trial_ending_reminders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT u.auth_id, u.push_token, u.premium_active_until
    FROM public.users u
    WHERE u.subscription_status = 'trial'
      AND u.premium_active_until IS NOT NULL
      AND u.premium_active_until > now() + interval '23 hours'
      AND u.premium_active_until <= now() + interval '25 hours'
      AND u.push_token IS NOT NULL
      -- Skip users already reminded for this trial expiry
      AND NOT EXISTS (
        SELECT 1 FROM public.trial_reminders_sent r
        WHERE r.user_id = u.auth_id
          AND r.premium_active_until = u.premium_active_until
      )
  LOOP
    BEGIN
      -- Enqueue the push
      INSERT INTO public.notification_queue (push_token, title, body, data)
      VALUES (
        v_row.push_token,
        'Your free trial ends tomorrow',
        'Your 7-day Fan Wave trial ends in 24 hours. We''ll charge $9.99/mo unless you cancel in Settings → Subscription.',
        jsonb_build_object('type', 'trial_ending', 'route', '/subscription')
      );

      -- Record the send
      INSERT INTO public.trial_reminders_sent
        (user_id, premium_active_until)
      VALUES
        (v_row.auth_id, v_row.premium_active_until)
      ON CONFLICT (user_id, premium_active_until) DO NOTHING;

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Swallow per-row errors so one bad push_token doesn't kill the
      -- whole batch.
      RAISE NOTICE 'trial reminder failed for user %: %', v_row.auth_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_trial_ending_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_trial_ending_reminders() FROM authenticated, anon;

-- ─── 3. Schedule it ─────────────────────────────────────────────────
-- pg_cron and pg_net were enabled in migration 029. Idempotent
-- unschedule + reschedule so re-applying this migration is safe.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial_ending_reminder') THEN
    PERFORM cron.unschedule('trial_ending_reminder');
  END IF;
END $$;

-- Every hour at the 7-minute mark (offset from the ESPN cron so they
-- don't collide on a CPU-busy second).
SELECT cron.schedule(
  'trial_ending_reminder',
  '7 * * * *',
  $cron$ SELECT public.run_trial_ending_reminders(); $cron$
);

-- Verification queries:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'trial_ending_reminder';
--   SELECT * FROM trial_reminders_sent ORDER BY sent_at DESC LIMIT 10;
--   SELECT * FROM notification_queue WHERE data->>'type' = 'trial_ending' ORDER BY created_at DESC LIMIT 10;
