#!/usr/bin/env node
/**
 * Audit the Play subscription catalogue against what the paywall promises.
 *
 *   node scripts/check-play-catalog.mjs
 *
 * Reads ./play-store-key.json — the same gitignored service-account key
 * eas.json's submit profile uses — and calls the Android Publisher API.
 * Read-only: every request is a GET.
 *
 * It exists because the Play Console shows a base plan as green "Active"
 * while its free-trial *offer* sits in Draft one screen deeper, and a Draft
 * offer is simply not served. The paywall still says "Start your 7-day free
 * trial", Play charges on day zero, and nothing anywhere reports an error —
 * the v9.4.5 advertised-vs-charged defect wearing a different hat.
 *
 * It also probes the two purchase endpoints RevenueCat needs. Catalogue reads
 * only require "View app information", so a service account can list every
 * product correctly and still be unable to validate a single receipt. The
 * probe sends a deliberately invalid purchase token: 400/404/410 means the
 * call was authorised and only the token was bad, which is the pass; 401/403
 * means the Play Console grants are missing.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const PKG = 'org.fansphere.app';
const KEY_PATH = new URL('../play-store-key.json', import.meta.url);
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

/** What the client sells. Keep in sync with TIER_PRODUCT_IDS in lib/entitlements.ts. */
const EXPECTED = [
  { productId: 'home_team_monthly_499', basePlanId: 'monthly', usd: 4.99, trial: true },
  { productId: 'home_team_annual_3499', basePlanId: 'annual', usd: 34.99, trial: true },
  { productId: 'mvp_monthly_1499', basePlanId: 'monthly', usd: 14.99, trial: false },
  { productId: 'mvp_annual_9999', basePlanId: 'annual', usd: 99.99, trial: false },
];

const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const input = [
    b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    b64u(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    })),
  ].join('.');
  const sig = createSign('RSA-SHA256').update(input).end().sign(sa.private_key);
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${b64u(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

async function get(token, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}

const usPrice = (basePlan) => {
  const us = (basePlan.regionalConfigs || []).find((r) => r.regionCode === 'US');
  if (!us?.price) return null;
  return Number(us.price.units || 0) + Number(us.price.nanos || 0) / 1e9;
};

const problems = [];

const sa = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const token = await accessToken(sa);
console.log(`service account : ${sa.client_email}`);

const { status, body } = await get(token, '/subscriptions?pageSize=50');
if (status !== 200) {
  console.error(`GET /subscriptions -> ${status}: ${body.error?.message ?? ''}`);
  process.exit(1);
}
const byId = new Map((body.subscriptions || []).map((s) => [s.productId, s]));

console.log('\n=== catalogue ===');
for (const want of EXPECTED) {
  const sub = byId.get(want.productId);
  if (!sub) {
    problems.push(`${want.productId} does not exist in Play`);
    console.log(`${want.productId.padEnd(24)} MISSING`);
    continue;
  }
  const bp = (sub.basePlans || []).find((b) => b.basePlanId === want.basePlanId);
  if (!bp) {
    // RevenueCat addresses Play products as `${productId}:${basePlanId}`, so a
    // renamed base plan yields a priceless package and an "Unavailable" paywall.
    problems.push(`${want.productId} has no base plan "${want.basePlanId}" (RevenueCat store_identifier would not resolve)`);
    console.log(`${want.productId.padEnd(24)} base plan "${want.basePlanId}" MISSING`);
    continue;
  }
  const price = usPrice(bp);
  if (bp.state !== 'ACTIVE') problems.push(`${want.productId}:${want.basePlanId} base plan is ${bp.state}, not ACTIVE — Play serves no price`);
  if (price !== want.usd) problems.push(`${want.productId}:${want.basePlanId} US price is ${price}, the paywall says ${want.usd}`);

  const offers = await get(token, `/subscriptions/${want.productId}/basePlans/${want.basePlanId}/offers?pageSize=20`);
  // 204 = the base plan has no offers at all.
  const rows = offers.status === 200 ? (offers.body.basePlanOffers || offers.body.subscriptionOffers || []) : [];
  const live = rows.filter((o) => o.state === 'ACTIVE');
  console.log(
    `${want.productId.padEnd(24)}:${want.basePlanId.padEnd(8)} ${String(bp.state).padEnd(8)} ` +
    `US=${price === null ? 'none' : price.toFixed(2)}  offers=${rows.length ? rows.map((o) => `${o.offerId}(${o.state})`).join(',') : 'none'}`,
  );

  if (want.trial && live.length === 0) {
    problems.push(
      `${want.productId}:${want.basePlanId} has no ACTIVE offer, but the paywall promises a 7-day free trial ` +
      `(offersTrial: true in PremiumPaywall.tsx) — Play would charge on day zero`,
    );
  }
  if (!want.trial && live.length > 0) {
    problems.push(`${want.productId}:${want.basePlanId} serves an offer, but the paywall promises no trial for this tier`);
  }
}

console.log('\n=== RevenueCat receipt-validation permissions ===');
for (const [label, path] of [
  ['purchases.subscriptionsv2.get', '/purchases/subscriptionsv2/tokens/PROBE_INVALID_TOKEN'],
  ['purchases.voidedpurchases.list', '/purchases/voidedpurchases?maxResults=1'],
]) {
  const r = await get(token, path);
  const ok = [200, 400, 404, 410].includes(r.status);
  console.log(`${label.padEnd(32)} HTTP ${r.status}  ${ok ? 'authorised' : 'NOT AUTHORISED'}`);
  if (!ok) {
    problems.push(
      `${label} returns ${r.status} — the service account lacks the Play Console grants ` +
      `("View financial data…" + "Manage orders and subscriptions"). RevenueCat cannot validate Android receipts with it.`,
    );
  }
}

console.log(`\n=== ${problems.length} problem(s) ===`);
for (const p of problems) console.log(` - ${p}`);
process.exit(problems.length ? 1 : 0);
