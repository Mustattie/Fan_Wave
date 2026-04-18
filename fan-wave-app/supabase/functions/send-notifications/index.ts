import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  type:
    | "score_update"
    | "game_reminder"
    | "watch_party_reminder"
    | "group_activity"
    | "moment_alert"
    | "clip_posted";
  team_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const TIER_REQUIREMENTS: Record<string, string[]> = {
  score_update: ["lite", "social", "all_in"],
  game_reminder: ["lite", "social", "all_in"],
  watch_party_reminder: ["social", "all_in"],
  group_activity: ["social", "all_in"],
  moment_alert: ["all_in"],
  clip_posted: ["all_in"],
};

const VALID_TYPES = new Set(Object.keys(TIER_REQUIREMENTS));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Authentication: require service role key ----
    const authHeader = req.headers.get("authorization");
    const expectedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, expectedKey);

    const payload: NotificationPayload = await req.json();
    const { type, team_id, title, body, data } = payload;

    // ---- Input validation ----
    if (!type || !team_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: type, team_id, title, body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!VALID_TYPES.has(type)) {
      return new Response(
        JSON.stringify({ error: `Invalid notification type: ${type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requiredTiers = TIER_REQUIREMENTS[type] || ["all_in"];

    const { data: followers, error } = await supabase
      .from("user_team_follows")
      .select("user_id, tier")
      .eq("team_id", team_id)
      .in("tier", requiredTiers);

    if (error) throw error;
    if (!followers || followers.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No eligible followers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userIds = followers.map((f: any) => f.user_id);
    const { data: users } = await supabase
      .from("users")
      .select("auth_id, push_token")
      .in("auth_id", userIds)
      .not("push_token", "is", null);

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No users with push tokens" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enqueue notifications for durable processing with retry
    const queuePayload = users.map((u: any) => ({
      push_token: u.push_token,
      title,
      body,
      data: data || {},
      sound: "default",
    }));

    const { data: enqueued, error: enqueueError } = await supabase
      .rpc("enqueue_notifications", {
        p_messages: JSON.stringify(queuePayload),
      });

    if (enqueueError) {
      console.error("Failed to enqueue:", enqueueError.message);
    }

    await supabase.from("analytics_events").insert(
      followers.map((f: any) => ({
        user_id: f.user_id,
        event_name: "notification_sent",
        metadata: { type, team_id, tier: f.tier },
      }))
    );

    return new Response(
      JSON.stringify({
        enqueued: enqueued ?? users.length,
        eligible: followers.length,
        withTokens: users.length,
        type,
        tiers: requiredTiers,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
