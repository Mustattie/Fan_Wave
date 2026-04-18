import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Scheduled Notification Trigger
 *
 * Called every 5 minutes by pg_cron. Checks for:
 * 1. Game reminders (30 min before scheduled_at)
 * 2. Watch party reminders (1 hr before starts_at)
 * 3. Score updates (games with status changes since last check)
 * 4. Final score notifications (games that just ended)
 *
 * Also accepts POST with { type: "score_update", game_id } for real-time triggers.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Tier requirements for each notification type
const TIER_MAP: Record<string, string[]> = {
  game_reminder: ["lite", "social", "all_in"],
  score_update: ["lite", "social", "all_in"],
  watch_party_reminder: ["social", "all_in"],
  group_activity: ["social", "all_in"],
};

interface PushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
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

    const allMessages: PushMessage[] = [];
    const results: Record<string, number> = {};

    // Check if this is a targeted trigger (POST with specific type)
    let targetType: string | null = null;
    let targetGameId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        targetType = body.type ?? null;
        targetGameId = body.game_id ?? null;
      } catch {
        // Not JSON — run all checks
      }
    }

    // ─── 1. GAME REMINDERS (30 min before) ───────────────────────
    if (!targetType || targetType === "game_reminder") {
      const now = new Date();
      const in25Min = new Date(now.getTime() + 25 * 60 * 1000);
      const in35Min = new Date(now.getTime() + 35 * 60 * 1000);

      const { data: upcomingGames } = await supabase
        .from("games")
        .select(
          "id, home_team_id, away_team_id, venue_name, scheduled_at, " +
            "home_team:teams!games_home_team_id_fkey(name), " +
            "away_team:teams!games_away_team_id_fkey(name)"
        )
        .eq("status", "scheduled")
        .gte("scheduled_at", in25Min.toISOString())
        .lte("scheduled_at", in35Min.toISOString());

      for (const game of upcomingGames ?? []) {
        const homeName = (game.home_team as any)?.name ?? "Home";
        const awayName = (game.away_team as any)?.name ?? "Away";
        const teamIds = [game.home_team_id, game.away_team_id];

        // Check dedup
        const { data: existing } = await supabase
          .from("notification_log")
          .select("id")
          .eq("ref_id", game.id)
          .eq("type", "game_reminder")
          .maybeSingle();

        if (existing) continue;

        const msgs = await getTeamFollowerMessages(
          supabase,
          teamIds,
          TIER_MAP.game_reminder,
          `${awayName} @ ${homeName}`,
          `Starting in 30 minutes at ${game.venue_name || "TBD"}`,
          "game_reminder",
          { game_id: game.id, screen: "home" }
        );
        allMessages.push(...msgs);

        // Log to prevent re-sending
        await supabase
          .from("notification_log")
          .insert({ ref_id: game.id, type: "game_reminder" });

        results["game_reminders"] = (results["game_reminders"] ?? 0) + 1;
      }
    }

    // ─── 2. SCORE UPDATES (targeted or batch) ────────────────────
    if (targetType === "score_update" && targetGameId) {
      const { data: game } = await supabase
        .from("games")
        .select(
          "id, home_team_id, away_team_id, home_score, away_score, status, " +
            "home_team:teams!games_home_team_id_fkey(name), " +
            "away_team:teams!games_away_team_id_fkey(name)"
        )
        .eq("id", targetGameId)
        .single();

      if (game) {
        const homeName = (game.home_team as any)?.name ?? "Home";
        const awayName = (game.away_team as any)?.name ?? "Away";
        const teamIds = [game.home_team_id, game.away_team_id];

        // Rate limit: 1 score notification per game per 5 minutes
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from("notification_log")
          .select("id")
          .eq("ref_id", game.id)
          .eq("type", "score_update")
          .gte("created_at", fiveMinAgo)
          .maybeSingle();

        if (!recent) {
          const isFinal = game.status === "post";
          const title = isFinal ? "Final Score" : "Score Update";
          const body = `${awayName} ${game.away_score ?? 0} - ${game.home_score ?? 0} ${homeName}${isFinal ? " (Final)" : ""}`;

          const msgs = await getTeamFollowerMessages(
            supabase,
            teamIds,
            TIER_MAP.score_update,
            title,
            body,
            "score_update",
            { game_id: game.id, screen: "home" }
          );
          allMessages.push(...msgs);

          await supabase
            .from("notification_log")
            .insert({ ref_id: game.id, type: isFinal ? "final_score" : "score_update" });

          results["score_updates"] = (results["score_updates"] ?? 0) + 1;
        }
      }
    }

    // ─── 3. WATCH PARTY REMINDERS (1 hr before) ──────────────────
    if (!targetType || targetType === "watch_party_reminder") {
      const now = new Date();
      const in55Min = new Date(now.getTime() + 55 * 60 * 1000);
      const in65Min = new Date(now.getTime() + 65 * 60 * 1000);

      const { data: upcomingParties } = await supabase
        .from("watch_parties")
        .select("id, title, venue_name, venue_city, starts_at")
        .gte("starts_at", in55Min.toISOString())
        .lte("starts_at", in65Min.toISOString());

      for (const party of upcomingParties ?? []) {
        // Check dedup
        const { data: existing } = await supabase
          .from("notification_log")
          .select("id")
          .eq("ref_id", party.id)
          .eq("type", "watch_party_reminder")
          .maybeSingle();

        if (existing) continue;

        // Get users who RSVP'd 'going'
        const { data: rsvps } = await supabase
          .from("watch_party_rsvps")
          .select("user_id")
          .eq("watch_party_id", party.id)
          .eq("status", "going");

        if (rsvps && rsvps.length > 0) {
          const userIds = rsvps.map((r: any) => r.user_id);

          // Get push tokens for these users (who have party reminders enabled)
          const { data: users } = await supabase
            .from("users")
            .select("push_token, notification_preferences")
            .in("auth_id", userIds)
            .not("push_token", "is", null);

          for (const u of users ?? []) {
            const prefs = u.notification_preferences as any;
            if (prefs?.watch_party_reminders === false) continue;

            allMessages.push({
              to: u.push_token,
              sound: "default",
              title: "Watch party starting soon!",
              body: `${party.title} at ${party.venue_name || party.venue_city} — 1 hour to go`,
              data: { party_id: party.id, screen: "watch-party" },
            });
          }

          await supabase
            .from("notification_log")
            .insert({ ref_id: party.id, type: "watch_party_reminder" });

          results["party_reminders"] = (results["party_reminders"] ?? 0) + 1;
        }
      }
    }

    // ─── ENQUEUE MESSAGES (processed by process-notification-queue) ─
    let totalEnqueued = 0;
    if (allMessages.length > 0) {
      // Convert to JSONB array for the enqueue_notifications RPC
      const queuePayload = allMessages.map((m) => ({
        push_token: m.to,
        title: m.title,
        body: m.body,
        data: m.data || {},
        sound: m.sound || "default",
      }));

      const { data: enqueued, error: enqueueError } = await supabase
        .rpc("enqueue_notifications", {
          p_messages: JSON.stringify(queuePayload),
        });

      if (enqueueError) {
        console.error("Failed to enqueue notifications:", enqueueError.message);
      } else {
        totalEnqueued = enqueued ?? allMessages.length;
      }
    }

    return new Response(
      JSON.stringify({ success: true, enqueued: totalEnqueued, total: allMessages.length, results }),
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
 * Helper: Get push messages for all followers of given teams at eligible tiers.
 */
async function getTeamFollowerMessages(
  supabase: any,
  teamIds: string[],
  tiers: string[],
  title: string,
  body: string,
  prefKey: string,
  data: Record<string, string>
): Promise<PushMessage[]> {
  const messages: PushMessage[] = [];

  const { data: followers } = await supabase
    .from("user_team_follows")
    .select("user_id, tier")
    .in("team_id", teamIds)
    .in("tier", tiers);

  if (!followers || followers.length === 0) return messages;

  const userIds = [...new Set(followers.map((f: any) => f.user_id))];

  const { data: users } = await supabase
    .from("users")
    .select("push_token, notification_preferences")
    .in("auth_id", userIds)
    .not("push_token", "is", null);

  for (const u of users ?? []) {
    const prefs = u.notification_preferences as any;
    // Check if user has this notification type enabled
    const prefMapping: Record<string, string> = {
      game_reminder: "game_reminders",
      score_update: "score_updates",
      watch_party_reminder: "watch_party_reminders",
      group_activity: "group_activity",
    };
    const prefField = prefMapping[prefKey] ?? prefKey;
    if (prefs && prefs[prefField] === false) continue;

    messages.push({ to: u.push_token, sound: "default", title, body, data });
  }

  return messages;
}
