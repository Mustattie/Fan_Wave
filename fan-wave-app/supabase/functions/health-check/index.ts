import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Health Check Endpoint
 *
 * Verifies database, auth, storage, realtime, sync freshness and the
 * notification queue. Used by monitoring tools (UptimeRobot, Grafana, etc.)
 * and SRE runbooks.
 *
 * AUTH: the request must carry EITHER
 *   - header `x-health-secret: <CRON_SHARED_SECRET>`, or
 *   - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Anything else gets a bare 401. Because external monitors cannot mint a
 * Supabase JWT, this function should be deployed with
 *   `supabase functions deploy health-check --no-verify-jwt`
 * once CRON_SHARED_SECRET is set in the project's function secrets. The
 * gateway-level verify_jwt setting in config.toml is intentionally not
 * changed here.
 *
 * Response body never echoes raw database / service error strings; each
 * check reports a short code and details go to console.error only.
 *
 * SLOs:
 *   - API response time:  p50 < 200ms, p99 < 2s
 *   - Uptime:             99.9% (<=43 min downtime/month)
 *   - Error rate:         < 0.1% of requests
 *   - Realtime delivery:  < 500ms
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-health-secret",
};

const PROBE_TIMEOUT_MS = 5_000;
const SYNC_DEGRADED_AFTER_S = 15 * 60;
const SYNC_ERROR_AFTER_S = 60 * 60;
const QUEUE_STUCK_AFTER_S = 5 * 60;
const QUEUE_OLDEST_PENDING_DEGRADED_S = 300;
const DEAD_LETTER_DEGRADED_AT = 100;

type Level = "ok" | "degraded" | "error";

interface Check {
  status: Level;
  latencyMs?: number;
  /** Short machine-readable reason; never a raw upstream error string. */
  code?: string;
}

interface HealthStatus {
  status: Level;
  timestamp: string;
  checks: {
    database: Check;
    auth: Check;
    storage: Check;
    realtime: Check;
    sync_freshness: Check & { ageSeconds: number | null };
    queue: Check & { pending: number; dead: number };
    queue_stuck: Check & { stuck: number };
    queue_oldest_pending_seconds: Check & { ageSeconds: number | null };
  };
  version: string;
}

function isAuthorised(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const headerSecret = req.headers.get("x-health-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  return (
    (cronSecret.length > 0 && headerSecret === cronSecret) ||
    (serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`)
  );
}

/** supabase-js query builders are thenables, not Promises, hence PromiseLike. */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function logFail(check: string, e: unknown) {
  console.error(`health-check ${check} failed:`, e instanceof Error ? e.message : e);
}

async function checkDatabase(supabase: any): Promise<Check> {
  const start = Date.now();
  try {
    const { error } = await withTimeout<any>(
      supabase.from("sports").select("id").limit(1).maybeSingle(),
      PROBE_TIMEOUT_MS,
      "db",
    );
    if (error) {
      logFail("database", error.message);
      return { status: "error", latencyMs: Date.now() - start, code: "query_failed" };
    }
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (e) {
    logFail("database", e);
    return { status: "error", latencyMs: Date.now() - start, code: "unreachable" };
  }
}

/**
 * Real GoTrue probe. `supabase.auth.getSession()` on a service client never
 * leaves the process (it reads local storage), so it was a fake check.
 */
async function checkAuth(supabaseUrl: string, apiKey: string): Promise<Check> {
  const start = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
      signal: ctl.signal,
    });
    if (!res.ok) {
      logFail("auth", `HTTP ${res.status}`);
      return { status: "error", latencyMs: Date.now() - start, code: `http_${res.status}` };
    }
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (e) {
    logFail("auth", e);
    return { status: "error", latencyMs: Date.now() - start, code: "unreachable" };
  } finally {
    clearTimeout(t);
  }
}

async function checkStorage(supabase: any): Promise<Check> {
  const start = Date.now();
  try {
    const { error } = await withTimeout<any>(
      supabase.storage.listBuckets(),
      PROBE_TIMEOUT_MS,
      "storage",
    );
    if (error) {
      logFail("storage", error.message);
      return { status: "error", latencyMs: Date.now() - start, code: "list_failed" };
    }
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (e) {
    logFail("storage", e);
    return { status: "error", latencyMs: Date.now() - start, code: "unreachable" };
  }
}

/**
 * Realtime probe: open the Phoenix socket, send one heartbeat, expect a
 * `phx_reply` within the timeout. Anything else is an error.
 */
function checkRealtime(supabaseUrl: string, apiKey: string): Promise<Check> {
  const start = Date.now();
  const wsUrl =
    `${supabaseUrl.replace(/^https/, "wss")}/realtime/v1/websocket?apikey=${
      encodeURIComponent(apiKey)
    }&vsn=1.0.0`;

  return new Promise<Check>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (check: Check) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      resolve(check);
    };
    const timer = setTimeout(() => {
      logFail("realtime", "heartbeat timed out");
      finish({ status: "error", latencyMs: Date.now() - start, code: "timeout" });
    }, PROBE_TIMEOUT_MS);

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      logFail("realtime", e);
      finish({ status: "error", latencyMs: Date.now() - start, code: "connect_failed" });
      return;
    }

    ws.onopen = () => {
      try {
        ws?.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "1" }));
      } catch (e) {
        logFail("realtime", e);
        finish({ status: "error", latencyMs: Date.now() - start, code: "send_failed" });
      }
    };
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg?.event === "phx_reply") {
          finish({ status: "ok", latencyMs: Date.now() - start });
        }
      } catch {
        // not JSON; keep waiting for the reply until the timer fires
      }
    };
    ws.onerror = (ev: Event) => {
      logFail("realtime", (ev as ErrorEvent)?.message ?? "socket error");
      finish({ status: "error", latencyMs: Date.now() - start, code: "socket_error" });
    };
    ws.onclose = () => {
      finish({ status: "error", latencyMs: Date.now() - start, code: "closed_before_reply" });
    };
  });
}

/** max(finished_at) of successful sync_runs (migration 107). */
async function checkSyncFreshness(supabase: any): Promise<Check & { ageSeconds: number | null }> {
  try {
    const { data, error } = await withTimeout<any>(
      supabase
        .from("sync_runs")
        .select("finished_at")
        .eq("ok", true)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      PROBE_TIMEOUT_MS,
      "sync_runs",
    );
    if (error) {
      logFail("sync_freshness", error.message);
      return { status: "error", code: "query_failed", ageSeconds: null };
    }
    if (!data?.finished_at) {
      return { status: "error", code: "no_successful_runs", ageSeconds: null };
    }
    const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(data.finished_at)) / 1000));
    if (ageSeconds > SYNC_ERROR_AFTER_S) return { status: "error", code: "stale", ageSeconds };
    if (ageSeconds > SYNC_DEGRADED_AFTER_S) return { status: "degraded", code: "aging", ageSeconds };
    return { status: "ok", ageSeconds };
  } catch (e) {
    logFail("sync_freshness", e);
    return { status: "error", code: "unreachable", ageSeconds: null };
  }
}

async function checkQueue(supabase: any): Promise<{
  queue: Check & { pending: number; dead: number };
  queue_stuck: Check & { stuck: number };
  queue_oldest_pending_seconds: Check & { ageSeconds: number | null };
}> {
  const queue: Check & { pending: number; dead: number } = { status: "ok", pending: 0, dead: 0 };
  const queue_stuck: Check & { stuck: number } = { status: "ok", stuck: 0 };
  const queue_oldest_pending_seconds: Check & { ageSeconds: number | null } = {
    status: "ok",
    ageSeconds: null,
  };

  try {
    const stuckBefore = new Date(Date.now() - QUEUE_STUCK_AFTER_S * 1000).toISOString();
    const [pendingRes, deadRes, stuckRes, oldestRes] = await withTimeout<any[]>(
      Promise.all([
        supabase
          .from("notification_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "failed"]),
        supabase
          .from("notification_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "dead"),
        supabase
          .from("notification_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "sending")
          .lt("claimed_at", stuckBefore),
        supabase
          .from("notification_queue")
          .select("created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]),
      PROBE_TIMEOUT_MS,
      "queue",
    );

    const firstErr = [pendingRes, deadRes, stuckRes, oldestRes].find((r: any) => r?.error)?.error;
    if (firstErr) {
      logFail("queue", firstErr.message);
      queue.status = "error";
      queue.code = "query_failed";
      queue_stuck.status = "error";
      queue_stuck.code = "query_failed";
      queue_oldest_pending_seconds.status = "error";
      queue_oldest_pending_seconds.code = "query_failed";
      return { queue, queue_stuck, queue_oldest_pending_seconds };
    }

    queue.pending = pendingRes.count ?? 0;
    queue.dead = deadRes.count ?? 0;
    if (queue.dead >= DEAD_LETTER_DEGRADED_AT) {
      queue.status = "degraded";
      queue.code = "dead_letters";
    }

    queue_stuck.stuck = stuckRes.count ?? 0;
    if (queue_stuck.stuck > 0) {
      queue_stuck.status = "error";
      queue_stuck.code = "stuck_sending";
    }

    const oldest = oldestRes.data?.created_at;
    if (oldest) {
      const age = Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 1000));
      queue_oldest_pending_seconds.ageSeconds = age;
      if (age > QUEUE_OLDEST_PENDING_DEGRADED_S) {
        queue_oldest_pending_seconds.status = "degraded";
        queue_oldest_pending_seconds.code = "backlog";
      }
    }
  } catch (e) {
    logFail("queue", e);
    queue.status = "error";
    queue.code = "unreachable";
    queue_stuck.status = "error";
    queue_stuck.code = "unreachable";
    queue_oldest_pending_seconds.status = "error";
    queue_oldest_pending_seconds.code = "unreachable";
  }

  return { queue, queue_stuck, queue_oldest_pending_seconds };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isAuthorised(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey;
  const supabase = createClient(supabaseUrl, serviceKey);

  const [database, auth, storage, realtime, sync_freshness, queueChecks] = await Promise.all([
    checkDatabase(supabase),
    checkAuth(supabaseUrl, anonKey),
    checkStorage(supabase),
    checkRealtime(supabaseUrl, anonKey),
    checkSyncFreshness(supabase),
    checkQueue(supabase),
  ]);

  const health: HealthStatus = {
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      database,
      auth,
      storage,
      realtime,
      sync_freshness,
      ...queueChecks,
    },
    version: "2.0.0",
  };

  const levels = Object.values(health.checks).map((c) => c.status);
  if (levels.includes("error")) health.status = "error";
  else if (levels.includes("degraded")) health.status = "degraded";

  return new Response(JSON.stringify(health, null, 2), {
    status: health.status === "error" ? 503 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
