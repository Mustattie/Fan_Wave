#!/usr/bin/env node
/**
 * Put the Home Team 7-day free trial live on Google Play.
 *
 *   node scripts/fix-play-trial-offers.mjs            # dry run, writes nothing
 *   node scripts/fix-play-trial-offers.mjs --apply    # writes to the live catalogue
 *
 * THE DEFECT (found 2026-08-27 by scripts/check-play-catalog.mjs):
 *
 *   home_team_monthly_499:monthly   offer freetrial7   DRAFT
 *   home_team_annual_3499:annual    no offer at all
 *
 * while PremiumPaywall renders "Start your 7-day free trial. We'll charge $X
 * after the trial ends" for both plans, because offersTrial is set per tier
 * (PremiumPaywall.tsx:51), not per plan. A DRAFT offer is not served and a
 * missing one obviously isn't either, so Play charges on day zero against copy
 * promising seven free days. Play Console shows the base plan as a green
 * "Active" throughout — the Draft sits one screen deeper, on the offer.
 *
 * WHAT IT DOES
 *   1. Activates freetrial7 on the monthly base plan.
 *   2. Creates the same offer on the annual base plan, mirroring the monthly
 *      one phase-for-phase and region-for-region, then activates it.
 *
 * WHAT IT WILL NOT DO
 *   - Touch either mvp_* product. MVP is sold with no trial by design
 *     (offersTrial: false), so an offer there would be the same
 *     advertised-vs-charged bug pointing the other way.
 *   - Copy a phase that is not a free P7D phase. If someone edits freetrial7
 *     into a paid intro offer, mirroring it onto annual would silently
 *     discount a $34.99 SKU; the script aborts instead.
 *   - Delete anything. An ACTIVE offer can be deactivated but never deleted,
 *     which is why the annual offer is created and activated as two steps with
 *     the draft printed in between.
 *
 * Auth is ./play-store-key.json, the gitignored service-account key eas.json
 * already submits with. Writing the catalogue needs the "Manage store presence"
 * grant in Play Console; a 401/403 here means that grant is missing, which is
 * separate from the receipt-validation grants RevenueCat needs.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const PKG = 'org.fansphere.app';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const APPLY = process.argv.includes('--apply');

const OFFER_ID = 'freetrial7';
const SOURCE = { productId: 'home_team_monthly_499', basePlanId: 'monthly' };
const TARGET = { productId: 'home_team_annual_3499', basePlanId: 'annual' };
const TRIAL_DURATION = 'P7D';

const b64u = (b) => Buffer.from(b).toString('base64url');

async function token() {
  const sa = JSON.parse(readFileSync(new URL('../play-store-key.json', import.meta.url), 'utf8'));
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
  return { token: (await res.json()).access_token, email: sa.client_email };
}

const auth = await token();

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json, ok: res.ok };
}

const offerPath = ({ productId, basePlanId }, offerId = '') =>
  `/subscriptions/${productId}/basePlans/${basePlanId}/offers${offerId ? `/${offerId}` : ''}`;

const fail = (msg) => { console.error(`\nABORT: ${msg}`); process.exit(1); };
const apiError = (r) => `HTTP ${r.status} ${r.json?.error?.status ?? ''} ${String(r.json?.error?.message ?? r.json?.raw ?? '').slice(0, 300)}`;

console.log(`service account : ${auth.email}`);
console.log(APPLY
  ? 'mode            : APPLY — this writes to the LIVE Play catalogue\n'
  : 'mode            : DRY RUN — nothing will be written\n');

// ── 1. Read the source offer and sanity-check its shape ──────────────
const src = await call('GET', offerPath(SOURCE, OFFER_ID));
if (!src.ok) fail(`cannot read ${SOURCE.productId}:${SOURCE.basePlanId}/${OFFER_ID} — ${apiError(src)}`);

const phases = src.json.phases ?? [];
if (phases.length !== 1) fail(`${OFFER_ID} has ${phases.length} phases; expected exactly 1 free trial phase.`);
const phase = phases[0];
if (phase.duration !== TRIAL_DURATION) fail(`${OFFER_ID} phase duration is ${phase.duration}, expected ${TRIAL_DURATION}. Refusing to mirror an offer that is not the 7-day trial.`);
const regionalConfigs = phase.regionalConfigs ?? [];
const paid = regionalConfigs.filter((r) => r.free === undefined);
if (paid.length) fail(`${OFFER_ID} charges in ${paid.length} region(s) (e.g. ${paid[0].regionCode}). This is not a free trial; refusing to copy it onto a $34.99 SKU.`);

console.log(`source offer    : ${SOURCE.productId}:${SOURCE.basePlanId}/${OFFER_ID}`);
console.log(`                  state=${src.json.state} phase=${phase.duration} x${phase.recurrenceCount} free in ${regionalConfigs.length} regions`);

// ── 2. Activate the monthly offer ────────────────────────────────────
if (src.json.state === 'ACTIVE') {
  console.log(`\n[1/2] ${SOURCE.productId}:${SOURCE.basePlanId} — already ACTIVE, nothing to do`);
} else if (!APPLY) {
  console.log(`\n[1/2] would POST ${offerPath(SOURCE, OFFER_ID)}:activate   (${src.json.state} -> ACTIVE)`);
} else {
  const r = await call('POST', `${offerPath(SOURCE, OFFER_ID)}:activate`, {});
  if (!r.ok) fail(`activating the monthly offer failed — ${apiError(r)}`);
  console.log(`\n[1/2] ${SOURCE.productId}:${SOURCE.basePlanId}/${OFFER_ID} -> ${r.json.state}`);
}

// ── 3. Mirror it onto the annual base plan ───────────────────────────
// Region coverage must match or the offer claims a free trial in a region the
// base plan has no price for.
const targetSub = await call('GET', `/subscriptions/${TARGET.productId}`);
if (!targetSub.ok) fail(`cannot read ${TARGET.productId} — ${apiError(targetSub)}`);
const targetPlan = (targetSub.json.basePlans ?? []).find((b) => b.basePlanId === TARGET.basePlanId);
if (!targetPlan) fail(`${TARGET.productId} has no base plan "${TARGET.basePlanId}".`);
const priced = new Set((targetPlan.regionalConfigs ?? []).map((r) => r.regionCode));
const unpriced = regionalConfigs.map((r) => r.regionCode).filter((c) => !priced.has(c));
if (unpriced.length) fail(`${unpriced.length} region(s) in the trial are not priced on the annual base plan (e.g. ${unpriced[0]}).`);
console.log(`target plan     : ${TARGET.productId}:${TARGET.basePlanId} state=${targetPlan.state}, ${priced.size} regions priced`);

const existing = await call('GET', offerPath(TARGET, OFFER_ID));
const body = {
  packageName: PKG,
  productId: TARGET.productId,
  basePlanId: TARGET.basePlanId,
  offerId: OFFER_ID,
  phases: src.json.phases,
  regionalConfigs: src.json.regionalConfigs,
  targeting: src.json.targeting,
  otherRegionsConfig: src.json.otherRegionsConfig,
};

if (existing.ok) {
  console.log(`\n[2/2] ${TARGET.productId}:${TARGET.basePlanId}/${OFFER_ID} already exists, state=${existing.json.state}`);
  if (existing.json.state === 'ACTIVE') {
    console.log('      nothing to do');
  } else if (!APPLY) {
    console.log(`      would POST ${offerPath(TARGET, OFFER_ID)}:activate   (${existing.json.state} -> ACTIVE)`);
  } else {
    const r = await call('POST', `${offerPath(TARGET, OFFER_ID)}:activate`, {});
    if (!r.ok) fail(`activating the annual offer failed — ${apiError(r)}`);
    console.log(`      -> ${r.json.state}`);
  }
} else if (!APPLY) {
  console.log(`\n[2/2] would POST ${offerPath(TARGET)}?offerId=${OFFER_ID}`);
  console.log(`      mirroring ${phase.duration} free x${phase.recurrenceCount} across ${regionalConfigs.length} regions,`);
  console.log(`      targeting ${JSON.stringify(src.json.targeting)}`);
  console.log(`      then POST ${offerPath(TARGET, OFFER_ID)}:activate`);
} else {
  // regionsVersion is required by some revisions of the create endpoint and
  // rejected by others; try the documented value, then without.
  let created = await call('POST', `${offerPath(TARGET)}?offerId=${OFFER_ID}&regionsVersion.version=2022%2F02`, body);
  if (!created.ok && /regionsVersion/i.test(JSON.stringify(created.json))) {
    console.log('      regionsVersion rejected, retrying without it');
    created = await call('POST', `${offerPath(TARGET)}?offerId=${OFFER_ID}`, body);
  }
  if (!created.ok) fail(`creating the annual offer failed — ${apiError(created)}`);
  console.log(`\n[2/2] created ${TARGET.productId}:${TARGET.basePlanId}/${OFFER_ID} state=${created.json.state}`);

  const r = await call('POST', `${offerPath(TARGET, OFFER_ID)}:activate`, {});
  if (!r.ok) fail(`created the annual offer but activating it failed — ${apiError(r)}. It is sitting in DRAFT; activate it in Play Console or re-run.`);
  console.log(`      -> ${r.json.state}`);
}

// ── 4. Report final state ────────────────────────────────────────────
console.log('\n=== final state ===');
for (const t of [SOURCE, TARGET]) {
  const r = await call('GET', offerPath(t, OFFER_ID));
  console.log(`${t.productId}:${t.basePlanId}/${OFFER_ID} -> ${r.ok ? r.json.state : `absent (${apiError(r)})`}`);
}
console.log(APPLY
  ? '\nRe-run scripts/check-play-catalog.mjs to confirm the paywall promise now matches the store.'
  : '\nDRY RUN — re-run with --apply to write.');
