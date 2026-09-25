import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  backoffSeconds,
  classifyExpoTickets,
  type ExpoTicket,
  type QueueRowForTicket,
} from "../_shared/expoTickets.ts";

/**
 * Process Notification Queue
 *
 * Called every 30 seconds by pg_cron. Picks up pending/failed notifications
 * and sends them to Expo Push API in batches of 100.
 *
 * Claiming (migration 104): batches are claimed atomically through the
 * `claim_notification_batch(p_limit int) RETURNS SETOF notification_queue`
 * RPC, which reaps stale 'sending' rows, then locks up to p_limit
 * pending / retry-due rows with FOR UPDATE SKIP LOCKED, sets
 * status='sending', claimed_at=now() and returns them. Two overlapping
 * worker invocations can no longer send the same row twice.
 *
 * Delivery: Expo's response is parsed per ticket (same order as the
 * messages sent). 'ok' rows are marked sent; DeviceNotRegistered rows are
 * dead-lettered AND the token is cleared from users.push_token so we stop
 * queueing for it; MessageRateExceeded and other errors retry with backoff.
 *
 * Retry strategy: exponential backoff (30s, 60s, 120s) with max 3 retries.
 * After max retries, messages are marked as 'dead' for manual inspection.
 */

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 10; // Process up to 1000 messages per invocation
// Migration 104's reaper hands back rows that have sat in 'sending' for more
// than 5 minutes. A run that outlives that lease would have its in-flight
// rows re-claimed by the next cron tick and pushed twice -- the exact
// duplicate this claiming scheme exists to prevent. Stop claiming new
// batches well inside the lease; whatever is left waits for the next tick.
const RUN_BUDGET_MS = 3 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Auth: accept either CRON_SHARED_SECRET or the auto-injected
    // SUPABASE_SERVICE_ROLE_KEY, matching sync-game-schedules and
    // trigger-notifications.
    //
    // Checking only the service role key is what kept trigger-notifications
    // 401ing after its cron was repaired (migration 088): the vault secret
    // `fan_wave_service_role_key` actually holds the CRON shared secret. This
    // function is about to be scheduled for the first time, so it would have
    // hit the identical wall — and, having never run, would have looked like
    // "the queue is empty" rather than "the worker is rejected".
    const cronSecret = Deno.env.get("CRON_SHARED_SECRET") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const authorised =
      (cronSecret.length > 0 && authHeader === `Bearer ${cronSecret}`) ||
      (serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`);
    if (!authorised) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let totalSent = 0;
    let totalFailed = 0;
    let totalDead = 0;
    let batchesProcessed = 0;
    const runStartedAt = Date.now();

    while (batchesProcessed < MAX_BATCHES_PER_RUN) {
      if (Date.now() - runStartedAt > RUN_BUDGET_MS) break;
      // Atomically claim the next batch (status -> 'sending', claimed_at set).
      const { data: batch, error } = await supabase.rpc(
        "claim_notification_batch",
        { p_limit: BATCH_SIZE },
      );

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      // Build Expo push messages
      const expoMessages = batch.map((m: any) => ({
        to: m.push_token,
        sound: m.sound || "default",
        title: m.title,
        body: m.body,
        data: m.data || {},
      }));

      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(expoMessages),
        });

        if (res.ok) {
          const tickets = await parseExpoTickets(res);
          if (!tickets) {
            // 2xx but unparseable body: treat as a transient batch failure.
            await handleBatchFailure(supabase, batch, "Expo response unparseable");
            totalFailed += batch.length;
          } else {
            const outcome = await handleBatchTickets(supabase, batch, tickets);
            totalSent += outcome.sent;
            totalFailed += outcome.failed;
            totalDead += outcome.dead;
          }
        } else {
          const errorText = await res.text().catch(() => "Unknown error");
          // Non-2xx: whole batch retries with backoff
          await handleBatchFailure(
            supabase,
            batch,
            `Expo HTTP ${res.status}: ${errorText.slice(0, 500)}`,
          );
          totalFailed += batch.length;
        }
      } catch (fetchErr) {
        // Network error — retry all
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        await handleBatchFailure(supabase, batch, errMsg);
        totalFailed += batch.length;
      }

      batchesProcessed++;
    }

    // Count dead letters for visibility
    const { count: deadCount } = await supabase
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead");

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        failed: totalFailed,
        dead: totalDead,
        deadLetters: deadCount ?? 0,
        batchesProcessed,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("process-notification-queue crashed:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Parse Expo's `{ data: ExpoTicket[] }` envelope. Returns null when the body
 * is not the shape we expect so the caller can fall back to a batch retry.
 */
async function parseExpoTickets(res: Response): Promise<ExpoTicket[] | null> {
  try {
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data)) return null;
    return data as ExpoTicket[];
  } catch {
    return null;
  }
}

/**
 * Apply per-ticket outcomes with one UPDATE per outcome group:
 *   sent   -> status='sent', sent_at=now()
 *   dead   -> status='dead', retry_count+1, error_message
 *   failed -> status='failed', retry_count+1, next_retry_at (backoff), error_message
 * plus one UPDATE on users to null push_token for DeviceNotRegistered tokens.
 *
 * Rows within a group can carry different retry_count values, so the
 * retry-bearing groups are bucketed by (retry_count, reason): a handful of
 * distinct buckets per batch, never one UPDATE per row.
 */
async function handleBatchTickets(
  supabase: any,
  batch: any[],
  tickets: ExpoTicket[],
): Promise<{ sent: number; failed: number; dead: number }> {
  const rows: QueueRowForTicket[] = batch.map((m: any) => ({
    id: m.id,
    push_token: m.push_token,
    retry_count: m.retry_count || 0,
    max_retries: m.max_retries || 3,
  }));
  const byId = new Map<string, QueueRowForTicket>(rows.map((r) => [r.id, r]));
  const outcome = classifyExpoTickets(rows, tickets);
  const nowIso = new Date().toISOString();

  if (outcome.sent.length > 0) {
    const { error } = await supabase
      .from("notification_queue")
      .update({ status: "sent", sent_at: nowIso })
      .in("id", outcome.sent);
    if (error) console.error("nq: mark sent failed:", error.message);
  }

  if (outcome.dead.length > 0) {
    await updateGroupedByRetry(supabase, outcome.dead, byId, (newRetryCount, reason) => ({
      status: "dead",
      retry_count: newRetryCount,
      error_message: reason,
    }));
  }

  if (outcome.failed.length > 0) {
    await updateGroupedByRetry(supabase, outcome.failed, byId, (newRetryCount, reason) => ({
      status: "failed",
      retry_count: newRetryCount,
      next_retry_at: new Date(Date.now() + backoffSeconds(newRetryCount) * 1000).toISOString(),
      error_message: reason,
    }));
  }

  if (outcome.deadTokens.length > 0) {
    // Stop queueing for devices Expo says are gone. Other pending rows for
    // the same token are dead-lettered by Expo on their own send.
    const { error } = await supabase
      .from("users")
      .update({ push_token: null })
      .in("push_token", outcome.deadTokens);
    if (error) console.error("nq: clearing dead push tokens failed:", error.message);
  }

  return {
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    dead: outcome.dead.length,
  };
}

/**
 * Group `items` by (new retry_count, reason) so each group is a single
 * UPDATE ... WHERE id IN (...).
 */
async function updateGroupedByRetry(
  supabase: any,
  items: Array<{ id: string; reason: string }>,
  byId: Map<string, QueueRowForTicket>,
  build: (newRetryCount: number, reason: string) => Record<string, unknown>,
) {
  const groups = new Map<string, { ids: string[]; retry: number; reason: string }>();
  for (const item of items) {
    const row = byId.get(item.id);
    const newRetryCount = (row?.retry_count ?? 0) + 1;
    const reason = item.reason.slice(0, 500);
    const key = `${newRetryCount}|${reason}`;
    const g = groups.get(key);
    if (g) g.ids.push(item.id);
    else groups.set(key, { ids: [item.id], retry: newRetryCount, reason });
  }
  for (const g of groups.values()) {
    const { error } = await supabase
      .from("notification_queue")
      .update(build(g.retry, g.reason))
      .in("id", g.ids);
    if (error) console.error("nq: grouped update failed:", error.message);
  }
}

/**
 * Handle a failed batch (non-2xx from Expo, network error, unparseable
 * body) — increment retry count or mark as dead, one UPDATE per
 * retry_count bucket. Exponential backoff: 30s * 2^(retry-1) (30s, 60s, 120s).
 */
async function handleBatchFailure(
  supabase: any,
  batch: any[],
  errorMessage: string,
) {
  const byId = new Map<string, QueueRowForTicket>();
  const dead: Array<{ id: string; reason: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const msg of batch) {
    const row: QueueRowForTicket = {
      id: msg.id,
      push_token: msg.push_token,
      retry_count: msg.retry_count || 0,
      max_retries: msg.max_retries || 3,
    };
    byId.set(row.id, row);
    const newRetryCount = row.retry_count + 1;
    if (newRetryCount >= row.max_retries) dead.push({ id: row.id, reason: errorMessage });
    else failed.push({ id: row.id, reason: errorMessage });
  }

  if (dead.length > 0) {
    await updateGroupedByRetry(supabase, dead, byId, (newRetryCount, reason) => ({
      status: "dead",
      retry_count: newRetryCount,
      error_message: reason,
    }));
  }
  if (failed.length > 0) {
    await updateGroupedByRetry(supabase, failed, byId, (newRetryCount, reason) => ({
      status: "failed",
      retry_count: newRetryCount,
      next_retry_at: new Date(Date.now() + backoffSeconds(newRetryCount) * 1000).toISOString(),
      error_message: reason,
    }));
  }
}
