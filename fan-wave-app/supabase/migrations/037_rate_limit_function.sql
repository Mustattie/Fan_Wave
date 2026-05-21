-- 037: re-create check_rate_limit() and rate_limits table.
-- Original definition lived in migration 018 but didn't stick on the
-- remote DB (018 was applied via the SQL editor long ago and the function
-- + table portion didn't make it through). FW-102 client code calls
-- this RPC from 4 sites (clip post, moment post, message send, RSVP)
-- so we need it on the remote before that gating is real.
--
-- IF NOT EXISTS guards make this idempotent — if a partial 018 already
-- created the table, this is a no-op for the data side; the function is
-- always CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS rate_limits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    action       TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    count        INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON rate_limits (user_id, action, window_start);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Service-role only — clients call via the RPC, not directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rate_limits_service_select' AND tablename = 'rate_limits') THEN
    CREATE POLICY rate_limits_service_select ON rate_limits FOR SELECT
      USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
  END IF;
END $$;

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

    SELECT COALESCE(SUM(count), 0) INTO v_count
    FROM rate_limits
    WHERE user_id = p_user_id
      AND action = p_action
      AND window_start >= v_window_start;

    IF v_count >= p_max_count THEN
        RETURN FALSE;
    END IF;

    INSERT INTO rate_limits (user_id, action)
    VALUES (p_user_id, p_action);

    -- Probabilistic GC of old entries (~1% of calls)
    IF random() < 0.01 THEN
        DELETE FROM rate_limits
        WHERE window_start < now() - interval '5 minutes';
    END IF;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION check_rate_limit(UUID, TEXT, INT, INT) TO authenticated, anon;
