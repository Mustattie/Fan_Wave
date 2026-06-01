-- 046: beta tester registry + per-tester activity RPCs.
--
-- Purpose: track the human + automated testers we onboard via TestFlight
-- (iOS) and Google Play Closed Testing (Android), so that if Apple/Google
-- review asks for evidence of multi-tester real-world use we can export it
-- in seconds. Two cohorts:
--   - 'wc2026-internal'  — Tatenda + 3 collaborators + Claude QA bot (~5 ppl)
--   - 'wc2026-external'  — 10–12 recruited human beta testers
-- The two cohorts are filterable so we never combine automated activity
-- with human totals in reviewer-facing exports.
--
-- Reuses existing infrastructure end-to-end:
--   - `analytics_events`        (migration 004)  → event-by-event activity
--   - `purchase_events`         (migration 032)  → sandbox IAP attempts
--   - `entitlements`            (migration 032)  → latest entitlement state
--   - `admin_roles` / is_admin()(migration 023)  → RPC access gating
--
-- No tables on the hot path are touched. Pure additive change.

-- ─── 1. Registry table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_testers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cohort           TEXT NOT NULL DEFAULT 'wc2026-external',
  recruited_via    TEXT,        -- 'friend' | 'discord' | 'reddit' | 'betafamily' | 'internal' | 'automated_qa'
  testflight_email TEXT,
  play_email       TEXT,
  notes            TEXT,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at       TIMESTAMPTZ,
  UNIQUE(user_id, cohort)
);

CREATE INDEX IF NOT EXISTS idx_beta_testers_user_id
  ON beta_testers(user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_beta_testers_cohort
  ON beta_testers(cohort)
  WHERE removed_at IS NULL;

-- ─── 2. Helpers ──────────────────────────────────────────────────────
-- is_beta_tester(uid) — boolean check used by future RPCs / RLS rules.
-- Mirrors the is_admin() pattern from migration 023.
CREATE OR REPLACE FUNCTION is_beta_tester(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM beta_testers
    WHERE user_id = p_user_id
      AND removed_at IS NULL
  );
$$;

-- ─── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE beta_testers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_beta_testers" ON beta_testers
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "service_role_manage_beta_testers" ON beta_testers
  FOR ALL TO service_role USING (true);

-- ─── 4. Per-tester activity summary ─────────────────────────────────
-- One row per active tester for the window. Reviewer-friendly columns:
-- shows total engagement + per-feature presence flags so we can tell at a
-- glance "this tester signed up, onboarded, joined a group, created a
-- party, etc."
--
-- p_days = 14 by default (matches the Google Play 14-day expectation).
-- p_cohort = NULL means "all cohorts"; pass 'wc2026-external' to filter
-- to human-only when exporting for reviewers.
CREATE OR REPLACE FUNCTION get_tester_activity_summary(
  p_days   INT DEFAULT 14,
  p_cohort TEXT DEFAULT NULL
)
RETURNS TABLE(
  user_id                  UUID,
  display_name             TEXT,
  cohort                   TEXT,
  recruited_via            TEXT,
  added_at                 TIMESTAMPTZ,
  first_event_at           TIMESTAMPTZ,
  last_event_at            TIMESTAMPTZ,
  active_days              INT,
  total_events             BIGINT,
  screens_visited          INT,
  distinct_event_types     INT,
  sessions_estimated       BIGINT,
  signed_up                BOOLEAN,
  onboarded                BOOLEAN,
  created_group            BOOLEAN,
  joined_group             BOOLEAN,
  created_party            BOOLEAN,
  rsvped_party             BOOLEAN,
  sent_message             BOOLEAN,
  uploaded_clip            BOOLEAN,
  liked_clip               BOOLEAN,
  shared_clip              BOOLEAN,
  exported_clip            BOOLEAN,
  shared_invite            BOOLEAN,
  opened_paywall           BOOLEAN,
  visited_world_cup_tab    BOOLEAN,
  sandbox_purchase_attempts BIGINT,
  latest_entitlement_status TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH window_def AS (
    SELECT NOW() - (GREATEST(p_days, 1) || ' days')::INTERVAL AS cutoff
  ),
  tester_set AS (
    SELECT bt.user_id, bt.cohort, bt.recruited_via, bt.added_at
    FROM beta_testers bt
    WHERE bt.removed_at IS NULL
      AND (p_cohort IS NULL OR bt.cohort = p_cohort)
  ),
  evt AS (
    SELECT
      ae.user_id,
      ae.event_name,
      ae.screen,
      ae.created_at
    FROM analytics_events ae
    JOIN tester_set ts ON ts.user_id = ae.user_id
    CROSS JOIN window_def
    WHERE ae.created_at >= window_def.cutoff
  ),
  evt_agg AS (
    SELECT
      user_id,
      MIN(created_at)                            AS first_event_at,
      MAX(created_at)                            AS last_event_at,
      COUNT(DISTINCT date_trunc('day', created_at))::INT AS active_days,
      COUNT(*)                                   AS total_events,
      COUNT(DISTINCT screen)::INT                AS screens_visited,
      COUNT(DISTINCT event_name)::INT            AS distinct_event_types,
      COUNT(*) FILTER (WHERE event_name = 'app_open')           AS sessions_estimated,
      BOOL_OR(event_name = 'sign_up')                           AS signed_up,
      BOOL_OR(event_name = 'onboarding_complete')               AS onboarded,
      BOOL_OR(event_name = 'group_created')                     AS created_group,
      BOOL_OR(event_name = 'group_joined')                      AS joined_group,
      BOOL_OR(event_name = 'watch_party_created')               AS created_party,
      BOOL_OR(event_name = 'watch_party_rsvp')                  AS rsvped_party,
      BOOL_OR(event_name = 'message_sent')                      AS sent_message,
      BOOL_OR(event_name = 'clip_uploaded')                     AS uploaded_clip,
      BOOL_OR(event_name = 'clip_liked')                        AS liked_clip,
      BOOL_OR(event_name IN ('clip_shared', 'content_shared'))  AS shared_clip,
      BOOL_OR(event_name = 'clip_exported')                     AS exported_clip,
      BOOL_OR(event_name = 'invite_shared')                     AS shared_invite,
      BOOL_OR(screen ILIKE 'paywall%')                          AS opened_paywall,
      BOOL_OR(screen ILIKE '%world_cup%' OR screen ILIKE '%world-cup%') AS visited_world_cup_tab
    FROM evt
    GROUP BY user_id
  ),
  purch AS (
    SELECT
      user_id,
      COUNT(*) AS sandbox_purchase_attempts
    FROM purchase_events pe
    CROSS JOIN window_def
    WHERE pe.created_at >= window_def.cutoff
    GROUP BY user_id
  ),
  ent AS (
    SELECT DISTINCT ON (user_id)
      user_id,
      status
    FROM entitlements
    ORDER BY user_id, updated_at DESC
  )
  SELECT
    ts.user_id,
    COALESCE(u.display_name, '(unknown)')                AS display_name,
    ts.cohort,
    ts.recruited_via,
    ts.added_at,
    ea.first_event_at,
    ea.last_event_at,
    COALESCE(ea.active_days, 0)                          AS active_days,
    COALESCE(ea.total_events, 0)                         AS total_events,
    COALESCE(ea.screens_visited, 0)                      AS screens_visited,
    COALESCE(ea.distinct_event_types, 0)                 AS distinct_event_types,
    COALESCE(ea.sessions_estimated, 0)                   AS sessions_estimated,
    COALESCE(ea.signed_up, false)                        AS signed_up,
    COALESCE(ea.onboarded, false)                        AS onboarded,
    COALESCE(ea.created_group, false)                    AS created_group,
    COALESCE(ea.joined_group, false)                     AS joined_group,
    COALESCE(ea.created_party, false)                    AS created_party,
    COALESCE(ea.rsvped_party, false)                     AS rsvped_party,
    COALESCE(ea.sent_message, false)                     AS sent_message,
    COALESCE(ea.uploaded_clip, false)                    AS uploaded_clip,
    COALESCE(ea.liked_clip, false)                       AS liked_clip,
    COALESCE(ea.shared_clip, false)                      AS shared_clip,
    COALESCE(ea.exported_clip, false)                    AS exported_clip,
    COALESCE(ea.shared_invite, false)                    AS shared_invite,
    COALESCE(ea.opened_paywall, false)                   AS opened_paywall,
    COALESCE(ea.visited_world_cup_tab, false)            AS visited_world_cup_tab,
    COALESCE(p.sandbox_purchase_attempts, 0)             AS sandbox_purchase_attempts,
    e.status                                             AS latest_entitlement_status
  FROM tester_set ts
  LEFT JOIN users u  ON u.id = ts.user_id
  LEFT JOIN evt_agg ea ON ea.user_id = ts.user_id
  LEFT JOIN purch p  ON p.user_id = ts.user_id
  LEFT JOIN ent e    ON e.user_id = ts.user_id
  WHERE is_admin()
  ORDER BY ts.cohort, ea.active_days DESC NULLS LAST, ts.added_at ASC;
$$;

-- ─── 5. Per-tester daily breakdown ──────────────────────────────────
-- One row per (day, user) in the window. Lets the admin screen render a
-- 14-cell heatmap per tester so we can show "this person logged in on 11
-- of 14 days, here are the gaps."
CREATE OR REPLACE FUNCTION get_tester_daily_activity(
  p_user_id UUID,
  p_days    INT DEFAULT 14
)
RETURNS TABLE(
  activity_date  DATE,
  event_count    BIGINT,
  distinct_types INT,
  sessions       BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT generate_series(
      (NOW() - (GREATEST(p_days, 1) || ' days')::INTERVAL)::DATE,
      NOW()::DATE,
      '1 day'::INTERVAL
    )::DATE AS day
  ),
  evt AS (
    SELECT
      created_at::DATE AS day,
      event_name
    FROM analytics_events
    WHERE user_id = p_user_id
      AND created_at >= NOW() - (GREATEST(p_days, 1) || ' days')::INTERVAL
  )
  SELECT
    d.day                                              AS activity_date,
    COALESCE(COUNT(e.event_name), 0)                   AS event_count,
    COALESCE(COUNT(DISTINCT e.event_name), 0)::INT     AS distinct_types,
    COALESCE(COUNT(*) FILTER (WHERE e.event_name = 'app_open'), 0) AS sessions
  FROM days d
  LEFT JOIN evt e ON e.day = d.day
  WHERE is_admin()
  GROUP BY d.day
  ORDER BY d.day ASC;
$$;

-- ─── 6. Convenience helpers for the admin screen ────────────────────
-- Cohort roll-up — one row per cohort, for the top-of-page summary cards.
CREATE OR REPLACE FUNCTION get_tester_cohort_summary(p_days INT DEFAULT 14)
RETURNS TABLE(
  cohort                TEXT,
  tester_count          INT,
  active_testers        INT,
  avg_active_days       NUMERIC,
  total_events          BIGINT,
  total_purchase_probes BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM get_tester_activity_summary(p_days, NULL)
  )
  SELECT
    s.cohort,
    COUNT(*)::INT                                          AS tester_count,
    COUNT(*) FILTER (WHERE s.active_days > 0)::INT         AS active_testers,
    ROUND(AVG(s.active_days)::NUMERIC, 2)                  AS avg_active_days,
    SUM(s.total_events)                                    AS total_events,
    SUM(s.sandbox_purchase_attempts)                       AS total_purchase_probes
  FROM s
  WHERE is_admin()
  GROUP BY s.cohort
  ORDER BY s.cohort;
$$;

-- ─── 7. Tester management RPCs ──────────────────────────────────────
-- Admin-callable inserts / soft-deletes so we can manage the registry
-- from the admin page without touching SQL. service_role can still write
-- directly via Supabase dashboard.
CREATE OR REPLACE FUNCTION admin_add_beta_tester(
  p_user_id       UUID,
  p_cohort        TEXT,
  p_recruited_via TEXT,
  p_testflight    TEXT DEFAULT NULL,
  p_play          TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO beta_testers (user_id, cohort, recruited_via, testflight_email, play_email, notes)
  VALUES (p_user_id, p_cohort, p_recruited_via, p_testflight, p_play, p_notes)
  ON CONFLICT (user_id, cohort) DO UPDATE
    SET removed_at = NULL,
        recruited_via = EXCLUDED.recruited_via,
        testflight_email = COALESCE(EXCLUDED.testflight_email, beta_testers.testflight_email),
        play_email = COALESCE(EXCLUDED.play_email, beta_testers.play_email),
        notes = COALESCE(EXCLUDED.notes, beta_testers.notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_remove_beta_tester(p_tester_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE beta_testers SET removed_at = now() WHERE id = p_tester_id;
END;
$$;

-- ─── 8. Inspection / verification ───────────────────────────────────
-- After apply, run these in the SQL editor as an admin user:
--
--   SELECT * FROM beta_testers;
--   -- expect empty
--
--   SELECT * FROM get_tester_cohort_summary(14);
--   -- expect 0 rows (no testers yet)
--
--   -- Insert a tester (replace with your own user_id):
--   SELECT admin_add_beta_tester(
--     '<your-user-id>'::uuid,
--     'wc2026-internal',
--     'internal',
--     'fansphere.reviewer@gmail.com',
--     'fansphere.reviewer@gmail.com',
--     'self-test'
--   );
--
--   SELECT * FROM get_tester_activity_summary(14, 'wc2026-internal');
--   -- expect 1 row, mostly false flags, active_days=0 if you haven't
--   -- triggered analytics events recently
--
--   SELECT * FROM get_tester_daily_activity('<your-user-id>'::uuid, 14);
--   -- expect 15 rows (today + 14 prior days), event_count=0 mostly
