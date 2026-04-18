import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Process Notification Queue
 *
 * Called every 30 seconds by pg_cron. Picks up pending/failed notifications
 * and sends them to Expo Push API in batches of 100.
 *
 * Retry strategy: exponential backoff (30s, 120s, 480s) with max 3 retries.
 * After max retries, messages are marked as 'dead' for manual inspection.
 */

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 10; // Process up to 1000 messages per invocation

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
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

    while (batchesProcessed < MAX_BATCHES_PER_RUN) {
      // Fetch next batch of pending or retryable messages
      const { data: batch, error } = await supabase
        .from("notification_queue")
        .select("*")
        .or(
          "status.eq.pending," +
          "and(status.eq.failed,next_retry_at.lte." + new Date().toISOString() + ")"
        )
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      // Mark as sending (claim the batch)
      const batchIds = batch.map((m: any) => m.id);
      await supabase
        .from("notification_queue")
        .update({ status: "sending" })
        .in("id", batchIds);

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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expoMessages),
        });

        if (res.ok) {
          // Mark all as sent
          await supabase
            .from("notification_queue")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .in("id", batchIds);
          totalSent += batch.length;
        } else {
          const errorText = await res.text().catch(() => "Unknown error");
          // Handle individual failures — mark for retry
          await handleBatchFailure(supabase, batch, errorText);
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
    totalDead = deadCount ?? 0;

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        failed: totalFailed,
        deadLetters: totalDead,
        batchesProcessed,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
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
 * Handle a failed batch — increment retry count or mark as dead.
 * Exponential backoff: 30s * 2^retry_count (30s, 60s, 120s)
 */
async function handleBatchFailure(
  supabase: any,
  batch: any[],
  errorMessage: string
) {
  for (const msg of batch) {
    const newRetryCount = (msg.retry_count || 0) + 1;

    if (newRetryCount >= (msg.max_retries || 3)) {
      // Dead letter
      await supabase
        .from("notification_queue")
        .update({
          status: "dead",
          retry_count: newRetryCount,
          error_message: errorMessage,
        })
        .eq("id", msg.id);
    } else {
      // Schedule retry with exponential backoff
      const backoffSeconds = 30 * Math.pow(2, newRetryCount - 1);
      const nextRetry = new Date(
        Date.now() + backoffSeconds * 1000
      ).toISOString();

      await supabase
        .from("notification_queue")
        .update({
          status: "failed",
          retry_count: newRetryCount,
          next_retry_at: nextRetry,
          error_message: errorMessage,
        })
        .eq("id", msg.id);
    }
  }
}
