-- ============================================================
-- Migration 010: Notification Triggers & Scheduling
--
-- 1. Notification log (dedup table)
-- 2. Score update trigger on games table
-- 3. pg_cron schedule for periodic notification checks
-- 4. Auto-cleanup of old notification log entries
-- ============================================================

-- =========================
-- 1. NOTIFICATION LOG (prevents duplicate notifications)
-- =========================

CREATE TABLE IF NOT EXISTS notification_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_id     UUID NOT NULL,
    type       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_ref_type
    ON notification_log(ref_id, type);

CREATE INDEX IF NOT EXISTS idx_notification_log_created
    ON notification_log(created_at);

-- RLS: only service role can read/write
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_service ON notification_log
    FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
    WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- =========================
-- 2. SCORE UPDATE TRIGGER
-- Fires when a game's score or status changes.
-- Uses pg_net to call the trigger-notifications edge function.
-- =========================

-- Helper function: notify on score/status change
CREATE OR REPLACE FUNCTION notify_score_update()
RETURNS TRIGGER AS $$
DECLARE
    v_url TEXT;
    v_key TEXT;
BEGIN
    -- Only fire if score or status actually changed
    IF (OLD.home_score IS DISTINCT FROM NEW.home_score)
       OR (OLD.away_score IS DISTINCT FROM NEW.away_score)
       OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('in', 'post'))
    THEN
        v_url := current_setting('app.settings.supabase_url', true)
                 || '/functions/v1/trigger-notifications';
        v_key := current_setting('app.settings.service_role_key', true);

        -- Use pg_net if available, otherwise skip silently
        BEGIN
            PERFORM net.http_post(
                url := v_url,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_key
                ),
                body := jsonb_build_object(
                    'type', 'score_update',
                    'game_id', NEW.id
                )
            );
        EXCEPTION WHEN OTHERS THEN
            -- pg_net not available or call failed — skip silently
            NULL;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the trigger (drop first if exists to make idempotent)
DROP TRIGGER IF EXISTS trg_notify_score_update ON games;
CREATE TRIGGER trg_notify_score_update
    AFTER UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION notify_score_update();

-- =========================
-- 3. CRON SCHEDULE (every 5 minutes)
-- Checks for game reminders and watch party reminders.
-- Requires pg_cron extension (enabled by default on Supabase).
-- =========================

-- Enable pg_cron and pg_net extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: every 5 minutes, trigger the notification function
-- This checks for games starting in ~30 min and parties starting in ~1 hour
SELECT cron.schedule(
    'trigger-scheduled-notifications',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/trigger-notifications',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := '{}'::jsonb
    );
    $$
);

-- =========================
-- 4. AUTO-CLEANUP: Remove notification logs older than 7 days
-- =========================

SELECT cron.schedule(
    'cleanup-notification-log',
    '0 3 * * *',
    $$
    DELETE FROM notification_log WHERE created_at < now() - interval '7 days';
    $$
);
