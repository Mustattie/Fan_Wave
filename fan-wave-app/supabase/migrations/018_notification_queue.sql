-- Migration 018: Notification Queue with Retry Logic
-- Replaces direct Expo Push API calls with a durable queue

-- ============================================================================
-- 1. NOTIFICATION QUEUE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_queue (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    push_token  TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    data        JSONB DEFAULT '{}',
    sound       TEXT DEFAULT 'default',
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    error_message TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    sent_at     TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes for queue processing
CREATE INDEX idx_nq_pending ON notification_queue (status, next_retry_at)
    WHERE status IN ('pending', 'failed');
CREATE INDEX idx_nq_created ON notification_queue (created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_nq_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nq_updated_at
    BEFORE UPDATE ON notification_queue
    FOR EACH ROW EXECUTE FUNCTION update_nq_timestamp();

-- ============================================================================
-- 2. HELPER: Enqueue notifications (called by trigger-notifications)
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_notifications(
    p_messages JSONB  -- Array of {push_token, title, body, data, sound}
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    msg JSONB;
    count INT := 0;
BEGIN
    FOR msg IN SELECT * FROM jsonb_array_elements(p_messages)
    LOOP
        INSERT INTO notification_queue (push_token, title, body, data, sound)
        VALUES (
            msg->>'push_token',
            msg->>'title',
            msg->>'body',
            COALESCE(msg->'data', '{}'::jsonb),
            COALESCE(msg->>'sound', 'default')
        );
        count := count + 1;
    END LOOP;
    RETURN count;
END;
$$;

-- ============================================================================
-- 3. AUTO-CLEANUP: Delete sent notifications older than 7 days
-- ============================================================================

-- Schedule cleanup (requires pg_cron extension)
-- SELECT cron.schedule(
--     'cleanup-notification-queue',
--     '0 3 * * *',  -- 3 AM daily
--     $$DELETE FROM notification_queue WHERE status = 'sent' AND created_at < now() - interval '7 days'$$
-- );

-- ============================================================================
-- 4. RATE LIMITING TABLE (O5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    action      TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    count       INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_rate_limits_lookup ON rate_limits (user_id, action, window_start);

-- Rate check function: returns TRUE if within limit
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_user_id UUID,
    p_action TEXT,
    p_max_count INT DEFAULT 60,
    p_window_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_count INT;
BEGIN
    v_window_start := now() - (p_window_seconds || ' seconds')::interval;

    -- Count requests in window
    SELECT COALESCE(SUM(count), 0) INTO v_count
    FROM rate_limits
    WHERE user_id = p_user_id
      AND action = p_action
      AND window_start >= v_window_start;

    IF v_count >= p_max_count THEN
        RETURN FALSE;  -- Rate limited
    END IF;

    -- Record this request
    INSERT INTO rate_limits (user_id, action)
    VALUES (p_user_id, p_action);

    -- Cleanup old entries (probabilistic, 1% of requests)
    IF random() < 0.01 THEN
        DELETE FROM rate_limits
        WHERE window_start < now() - interval '5 minutes';
    END IF;

    RETURN TRUE;
END;
$$;
