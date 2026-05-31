import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS (RevenueCat sends server-side so CORS rarely matters, but kept for
// manual testing via curl / dashboard)
// ---------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Product → entitlement family. Anything not listed here is logged but
// otherwise ignored — keeps the webhook safe to deploy before all products
// are wired up in the RevenueCat dashboard.
// ---------------------------------------------------------------------------
const PREMIUM_PRODUCTS = new Set([
  "premium_monthly_999",
  "premium_annual_10788",
]);
const WC_PASS_PRODUCTS = new Set([
  "wc_pass_2026",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RevenueCatEvent {
  type: string;
  id: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  period_type?: "TRIAL" | "NORMAL" | "INTRO" | "PROMOTIONAL";
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  transaction_id?: string;
  original_transaction_id?: string;
  store?: string;
  environment?: "PRODUCTION" | "SANDBOX";
  // Allow unknown fields without losing them — we store the whole payload
  // in purchase_events.payload anyway.
  [key: string]: unknown;
}

interface RevenueCatBody {
  event: RevenueCatEvent;
}

// ---------------------------------------------------------------------------
// Entitlement state mapping
// ---------------------------------------------------------------------------
function mapEventToEntitlementStatus(
  eventType: string,
  periodType: string | undefined,
): { entitlementStatus: string; userStatus: string | null } | null {
  // userStatus = what to write to users.subscription_status; null means
  // "don't update this column" (some events shouldn't flip user-visible state).
  switch (eventType) {
    case "INITIAL_PURCHASE":
    case "TRIAL_STARTED":
      if (periodType === "TRIAL" || periodType === "INTRO") {
        return { entitlementStatus: "trialing", userStatus: "trial" };
      }
      return { entitlementStatus: "active", userStatus: "active" };
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
      return { entitlementStatus: "active", userStatus: "active" };
    case "CANCELLATION":
      // User turned off auto-renew but access remains until expiration.
      // Track on entitlement row only; don't flip users.subscription_status
      // until EXPIRATION fires (otherwise we'd boot a still-paid user to
      // the Resubscribe screen).
      return { entitlementStatus: "cancelled", userStatus: null };
    case "EXPIRATION":
      return { entitlementStatus: "expired", userStatus: "expired" };
    case "REFUND":
      // Immediate revocation — user got their money back.
      return { entitlementStatus: "refunded", userStatus: "cancelled" };
    case "BILLING_ISSUE":
      // Grace period — keep access, just record the issue on the entitlement.
      return { entitlementStatus: "billing_issue", userStatus: null };
    case "NON_RENEWING_PURCHASE":
      // One-time purchase (WC Pass). status doesn't apply to the
      // subscription state; users.wc_pass_active_until is what matters.
      return { entitlementStatus: "active", userStatus: null };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ─── Authentication ─────────────────────────────────────────────────
  // RevenueCat sends a shared-secret bearer in the Authorization header.
  // The secret is configured both here (via `supabase secrets set
  // REVENUECAT_WEBHOOK_SECRET=...`) and in the RevenueCat dashboard.
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const authHeader = req.headers.get("authorization");
  if (!expected || !authHeader || authHeader !== `Bearer ${expected}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ─── Parse payload ───────────────────────────────────────────────────
  let body: RevenueCatBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const event = body?.event;
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return json({ error: "Missing event.id or event.type" }, 400);
  }

  // ─── Supabase service client (bypasses RLS for entitlement writes) ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ─── Idempotency guard ──────────────────────────────────────────────
  // Insert purchase_events first with ON CONFLICT (event_id) DO NOTHING.
  // If a row already existed, the event has been processed before and we
  // return 200 without doing anything else. RevenueCat retries on non-2xx,
  // so duplicates are guaranteed at some point.
  const { data: eventRow, error: eventErr } = await supabase
    .from("purchase_events")
    .insert({
      event_id: event.id,
      user_id: event.app_user_id ?? null,
      event_type: event.type,
      payload: event,
    })
    .select("id")
    .maybeSingle();
  if (eventErr) {
    // Unique violation on event_id = already processed. Anything else is
    // a real DB error worth logging.
    if (!/duplicate key|already exists/i.test(eventErr.message)) {
      console.error("purchase_events insert failed:", eventErr);
      return json({ error: "Storage error" }, 500);
    }
    return json({ ok: true, deduped: true });
  }
  // If the insert was a no-op (existing row), eventRow is null and we exit
  // early.
  if (!eventRow) {
    return json({ ok: true, deduped: true });
  }

  // ─── Apply the event ────────────────────────────────────────────────
  const mapping = mapEventToEntitlementStatus(event.type, event.period_type);
  if (!mapping) {
    // Unknown event type — already recorded in purchase_events; nothing
    // more to do.
    return json({ ok: true, ignored: event.type });
  }

  const productId = event.product_id ?? "";
  // Android subscriptions arrive as "subscriptionId:basePlanId"
  // (e.g., "premium_monthly_999:monthly"); iOS sends just "subscriptionId".
  // Normalize for the entitlement-family lookup, but persist the raw ID
  // so we can tell stores apart later if needed.
  const baseProductId = productId.split(":")[0];
  const isPremium = PREMIUM_PRODUCTS.has(baseProductId);
  const isWcPass = WC_PASS_PRODUCTS.has(baseProductId);

  // Upsert the entitlement row keyed on original_transaction_id.
  if (event.original_transaction_id) {
    const expiresAt = event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;
    const { error: entErr } = await supabase
      .from("entitlements")
      .upsert(
        {
          user_id: event.app_user_id,
          product_id: productId,
          status: mapping.entitlementStatus,
          original_transaction_id: event.original_transaction_id,
          expires_at: expiresAt,
          raw_payload: event,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "original_transaction_id" },
      );
    if (entErr) {
      console.error("entitlements upsert failed:", entErr);
      return json({ error: "Storage error" }, 500);
    }
  }

  // Denormalize to users table so RLS doesn't have to JOIN on every check.
  // app_user_id is the auth.users.id (set via Purchases.logIn(user.id) on
  // the client); we update public.users WHERE auth_id = app_user_id.
  if (event.app_user_id) {
    const updates: Record<string, unknown> = {};
    const expirationISO = event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;

    if (isPremium) {
      if (mapping.userStatus !== null) {
        updates.subscription_status = mapping.userStatus;
      }
      // EXPIRATION / REFUND should clear the expiration timestamp so
      // has_premium_access fails closed.
      if (event.type === "EXPIRATION" || event.type === "REFUND") {
        updates.premium_active_until = null;
      } else if (expirationISO) {
        updates.premium_active_until = expirationISO;
      }
    }
    if (isWcPass) {
      if (event.type === "REFUND") {
        updates.wc_pass_active_until = null;
      } else if (expirationISO) {
        updates.wc_pass_active_until = expirationISO;
      } else {
        // Non-renewing purchase with no expiration_at_ms — fall back to
        // a fixed window so a malformed payload doesn't grant forever.
        // WC Pass is valid through 2026-07-26 (1 week buffer past Final).
        updates.wc_pass_active_until = "2026-07-26T23:59:59Z";
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: usrErr } = await supabase
        .from("users")
        .update(updates)
        .eq("auth_id", event.app_user_id);
      if (usrErr) {
        console.error("users denormalization failed:", usrErr);
        return json({ error: "Storage error" }, 500);
      }
    }
  }

  // Mark the event as processed.
  await supabase
    .from("purchase_events")
    .update({ processed: true })
    .eq("id", eventRow.id);

  return json({ ok: true, event_type: event.type });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
