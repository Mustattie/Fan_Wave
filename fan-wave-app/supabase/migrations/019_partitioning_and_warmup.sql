-- Migration 019: Table Partitioning & Edge Function Warm-up
-- Addresses unbounded table growth and cold start latency

-- ============================================================================
-- 1. TABLE PARTITIONING
-- ============================================================================
-- Note: Partitioning existing tables in Supabase requires careful migration.
-- This creates partitioned replacement tables and a migration path.

-- ---- analytics_events partitioned by month ----
CREATE TABLE IF NOT EXISTS analytics_events_partitioned (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID,
    event_name TEXT NOT NULL,
    screen TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create partitions for current and next 6 months
DO $$
DECLARE
    start_date DATE := date_trunc('month', CURRENT_DATE);
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..6 LOOP
        end_date := start_date + interval '1 month';
        partition_name := 'analytics_events_p' || to_char(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events_partitioned
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        start_date := end_date;
    END LOOP;
END $$;

-- Default partition for out-of-range data
CREATE TABLE IF NOT EXISTS analytics_events_default
    PARTITION OF analytics_events_partitioned DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_part_created
    ON analytics_events_partitioned (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_part_user
    ON analytics_events_partitioned (user_id, created_at DESC);

-- ---- messages partitioned by month ----
CREATE TABLE IF NOT EXISTS messages_partitioned (
    id UUID DEFAULT gen_random_uuid(),
    chat_room_id UUID NOT NULL,
    user_id UUID NOT NULL,
    content TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
    start_date DATE := date_trunc('month', CURRENT_DATE);
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..6 LOOP
        end_date := start_date + interval '1 month';
        partition_name := 'messages_p' || to_char(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF messages_partitioned
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        start_date := end_date;
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS messages_default
    PARTITION OF messages_partitioned DEFAULT;

CREATE INDEX IF NOT EXISTS idx_messages_part_room
    ON messages_partitioned (chat_room_id, created_at DESC);

-- ---- notification_queue partitioned by month ----
CREATE TABLE IF NOT EXISTS notification_queue_partitioned (
    id UUID DEFAULT gen_random_uuid(),
    push_token TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    sound TEXT DEFAULT 'default',
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
    start_date DATE := date_trunc('month', CURRENT_DATE);
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..6 LOOP
        end_date := start_date + interval '1 month';
        partition_name := 'nq_p' || to_char(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF notification_queue_partitioned
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );

        start_date := end_date;
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS nq_default
    PARTITION OF notification_queue_partitioned DEFAULT;

-- ============================================================================
-- 2. AUTO-CREATE FUTURE PARTITIONS (monthly cron job)
-- ============================================================================
-- Uncomment when pg_cron is available on your Supabase plan:

-- CREATE OR REPLACE FUNCTION create_monthly_partitions()
-- RETURNS void LANGUAGE plpgsql AS $$
-- DECLARE
--     next_month DATE := date_trunc('month', CURRENT_DATE + interval '1 month');
--     month_after DATE := next_month + interval '1 month';
--     suffix TEXT := to_char(next_month, 'YYYY_MM');
-- BEGIN
--     EXECUTE format('CREATE TABLE IF NOT EXISTS analytics_events_p%s PARTITION OF analytics_events_partitioned FOR VALUES FROM (%L) TO (%L)', suffix, next_month, month_after);
--     EXECUTE format('CREATE TABLE IF NOT EXISTS messages_p%s PARTITION OF messages_partitioned FOR VALUES FROM (%L) TO (%L)', suffix, next_month, month_after);
--     EXECUTE format('CREATE TABLE IF NOT EXISTS nq_p%s PARTITION OF notification_queue_partitioned FOR VALUES FROM (%L) TO (%L)', suffix, next_month, month_after);
-- END $$;
--
-- SELECT cron.schedule('create-monthly-partitions', '0 0 25 * *', 'SELECT create_monthly_partitions()');

-- ============================================================================
-- 3. EDGE FUNCTION WARM-UP (ping every 4 minutes to prevent cold starts)
-- ============================================================================
-- Uncomment when pg_cron is available:

-- SELECT cron.schedule(
--     'warmup-edge-functions',
--     '*/4 * * * *',
--     $$
--     SELECT
--         net.http_post(
--             url := current_setting('app.settings.supabase_url') || '/functions/v1/health-check',
--             headers := jsonb_build_object(
--                 'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
--             ),
--             body := '{}'::jsonb
--         );
--     $$
-- );
