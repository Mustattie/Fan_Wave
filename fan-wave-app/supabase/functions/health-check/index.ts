import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Health Check Endpoint
 *
 * Verifies database connectivity and basic service health.
 * Used by monitoring tools (UptimeRobot, Grafana, etc.) and SRE runbooks.
 *
 * SLOs:
 *   - API response time:  p50 < 200ms, p99 < 2s
 *   - Uptime:             99.9% (≤43 min downtime/month)
 *   - Error rate:         < 0.1% of requests
 *   - Realtime delivery:  < 500ms
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    database: { ok: boolean; latencyMs: number; error?: string };
    auth: { ok: boolean; latencyMs: number; error?: string };
    storage: { ok: boolean; latencyMs: number; error?: string };
    notificationQueue: { ok: boolean; pending: number; dead: number };
  };
  version: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const health: HealthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    checks: {
      database: { ok: false, latencyMs: 0 },
      auth: { ok: false, latencyMs: 0 },
      storage: { ok: false, latencyMs: 0 },
      notificationQueue: { ok: false, pending: 0, dead: 0 },
    },
    version: "1.0.0",
  };

  // 1. Database check — simple SELECT
  const dbStart = Date.now();
  try {
    const { error } = await supabase
      .from("sports")
      .select("id")
      .limit(1)
      .single();
    health.checks.database.latencyMs = Date.now() - dbStart;
    health.checks.database.ok = !error;
    if (error) health.checks.database.error = error.message;
  } catch (e) {
    health.checks.database.latencyMs = Date.now() - dbStart;
    health.checks.database.error = e instanceof Error ? e.message : "Unknown";
  }

  // 2. Auth service check
  const authStart = Date.now();
  try {
    const { error } = await supabase.auth.getSession();
    health.checks.auth.latencyMs = Date.now() - authStart;
    health.checks.auth.ok = !error;
    if (error) health.checks.auth.error = error.message;
  } catch (e) {
    health.checks.auth.latencyMs = Date.now() - authStart;
    health.checks.auth.error = e instanceof Error ? e.message : "Unknown";
  }

  // 3. Storage check — list buckets
  const storageStart = Date.now();
  try {
    const { error } = await supabase.storage.listBuckets();
    health.checks.storage.latencyMs = Date.now() - storageStart;
    health.checks.storage.ok = !error;
    if (error) health.checks.storage.error = error.message;
  } catch (e) {
    health.checks.storage.latencyMs = Date.now() - storageStart;
    health.checks.storage.error = e instanceof Error ? e.message : "Unknown";
  }

  // 4. Notification queue health
  try {
    const { count: pending } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "failed"]);

    const { count: dead } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead");

    health.checks.notificationQueue.pending = pending ?? 0;
    health.checks.notificationQueue.dead = dead ?? 0;
    health.checks.notificationQueue.ok = (dead ?? 0) < 100; // Alert if too many dead letters
  } catch {
    health.checks.notificationQueue.ok = false;
  }

  // Determine overall status
  const checks = Object.values(health.checks);
  const allOk = checks.every((c) => c.ok);
  const anyFailed = checks.some((c) => !c.ok);

  if (!allOk && anyFailed) {
    const criticalDown = !health.checks.database.ok || !health.checks.auth.ok;
    health.status = criticalDown ? "unhealthy" : "degraded";
  }

  const httpStatus = health.status === "unhealthy" ? 503 : 200;

  return new Response(JSON.stringify(health, null, 2), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
