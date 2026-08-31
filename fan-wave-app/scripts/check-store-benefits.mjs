#!/usr/bin/env node
/**
 * Keep the benefit copy in the two stores equal to what the app actually sells.
 *
 *   node scripts/check-store-benefits.mjs            # report drift, write nothing
 *   node scripts/check-store-benefits.mjs --apply    # push EXPECTED to both stores
 *
 * Exits non-zero when any store disagrees, so it can gate a release.
 *
 * WHY THIS EXISTS
 *   docs/tier-promises-audit.md: the paywall sold eleven benefits and one was
 *   enforced. The store listings carried the same wrong list, and store copy is
 *   the version an App Store reviewer reads — the version that turns a copy bug
 *   into a 3.1.2 rejection. Three surfaces (TIER_CONFIG, Play benefits, ASC
 *   localizations) drifted because nothing compared them.
 *
 *   EXPECTED below is the single source of truth and must stay equal to
 *   TIER_CONFIG in components/paywall/PremiumPaywall.tsx. If you change one,
 *   change both and re-run this.
 *
 * AUTH
 *   Play  ./play-store-key.json      (needs "Manage store presence")
 *   ASC   ~/Downloads/AuthKey_DP56C6TV9V.p8, key DP56C6TV9V
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const PKG = 'org.fansphere.app';
const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

/** Mirrors TIER_CONFIG.features. Play caps a benefit at 40 chars, so these are
 *  the short forms of the same four claims the paywall makes. */
const EXPECTED = {
  home_team: {
    products: ['home_team_monthly_499', 'home_team_annual_3499'],
    benefits: [
      'Unlimited clip posting',
      'Private, invite-only watch parties',
      "See who's coming, maybe, or out",
      'Home Team badge fans can see',
    ],
    // ASC subscription description is one line, not a list.
    ascDescription: 'Unlimited clips + private watch parties',
    ascIds: {
      home_team_monthly_499: '5ecfa849-035a-493a-9e81-0d262e26b51b',
      home_team_annual_3499: 'f7ba6545-3875-4a6d-af42-dd14f14297de',
    },
  },
  mvp: {
    products: ['mvp_monthly_1499', 'mvp_annual_9999'],
    benefits: [
      'Everything in Home Team',
      'Advanced audience analytics',
      'Verified creator badge',
      'Featured placement in Discover',
    ],
    ascDescription: 'Analytics, verified badge & featured placement',
    ascIds: {
      mvp_monthly_1499: '09c4234b-ff37-4403-a683-a1c4ec0a3024',
      mvp_annual_9999: 'ce90fd23-49ed-4e19-9929-110acd8786f8',
    },
  },
};

const b64u = (b) => Buffer.from(b).toString('base64url');
const problems = [];
const changes = [];

// ── Play ────────────────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(new URL('../play-store-key.json', import.meta.url), 'utf8'));

async function playToken() {
  const now = Math.floor(Date.now() / 1000);
  const input = [
    b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    b64u(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri, iat: now, exp: now + 3600,
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
  if (!res.ok) throw new Error(`Play token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

const PT = await playToken();
const play = async (method, path, body) => {
  const res = await fetch(PLAY_API + path, {
    method,
    headers: { Authorization: `Bearer ${PT}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await res.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, j };
};

console.log('=== Google Play ===');
for (const [tier, cfg] of Object.entries(EXPECTED)) {
  for (const pid of cfg.products) {
    const cur = await play('GET', `/subscriptions/${pid}`);
    if (!cur.ok) { problems.push(`${pid}: GET failed HTTP ${cur.status}`); continue; }
    const listing = (cur.j.listings || []).find((l) => l.languageCode === 'en-US');
    const same = JSON.stringify(listing?.benefits ?? []) === JSON.stringify(cfg.benefits);
    console.log(`${pid.padEnd(24)} ${same ? 'match' : 'DRIFT'}`);
    if (same) continue;
    console.log(`   have: ${JSON.stringify(listing?.benefits ?? [])}`);
    console.log(`   want: ${JSON.stringify(cfg.benefits)}`);
    problems.push(`${pid}: Play benefits do not match the ${tier} paywall copy`);
    if (!APPLY) continue;

    const listings = (cur.j.listings || []).map((l) =>
      l.languageCode === 'en-US' ? { ...l, benefits: cfg.benefits } : l);
    let r = await play('PATCH',
      `/subscriptions/${pid}?updateMask=listings&regionsVersion.version=2022%2F02`,
      { packageName: PKG, productId: pid, listings });
    if (!r.ok && /regionsVersion/i.test(JSON.stringify(r.j))) {
      r = await play('PATCH', `/subscriptions/${pid}?updateMask=listings`,
        { packageName: PKG, productId: pid, listings });
    }
    if (!r.ok) problems.push(`${pid}: PATCH failed HTTP ${r.status} ${String(r.j?.error?.message).slice(0, 160)}`);
    else changes.push(`Play ${pid} benefits updated`);
  }
}

// ── App Store Connect ───────────────────────────────────────────────
const ascKeyPath = join(homedir(), 'Downloads', 'AuthKey_DP56C6TV9V.p8');
const now = Math.floor(Date.now() / 1000);
const ascInput = [
  b64u(JSON.stringify({ alg: 'ES256', kid: 'DP56C6TV9V', typ: 'JWT' })),
  b64u(JSON.stringify({
    iss: 'e60d3fc7-a3e5-4eb4-8fcf-1e2c155ff7a4',
    iat: now, exp: now + 900, aud: 'appstoreconnect-v1',
  })),
].join('.');
const ascSig = createSign('SHA256').update(ascInput).end()
  .sign({ key: readFileSync(ascKeyPath, 'utf8'), dsaEncoding: 'ieee-p1363' });
const AT = `${ascInput}.${b64u(ascSig)}`;
const asc = async (method, path, body) => {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${AT}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await res.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, j };
};

console.log('\n=== App Store Connect ===');
for (const [tier, cfg] of Object.entries(EXPECTED)) {
  for (const [pid, locId] of Object.entries(cfg.ascIds)) {
    const cur = await asc('GET', `/v1/subscriptionLocalizations/${locId}`);
    if (!cur.ok) { problems.push(`${pid}: ASC GET failed HTTP ${cur.status}`); continue; }
    const have = cur.j.data?.attributes?.description ?? '';
    const same = have === cfg.ascDescription;
    console.log(`${pid.padEnd(24)} ${same ? 'match' : 'DRIFT'}`);
    if (same) continue;
    console.log(`   have: ${have}`);
    console.log(`   want: ${cfg.ascDescription}`);
    problems.push(`${pid}: ASC description does not match the ${tier} paywall copy`);
    if (!APPLY) continue;

    const r = await asc('PATCH', `/v1/subscriptionLocalizations/${locId}`, {
      data: {
        type: 'subscriptionLocalizations',
        id: locId,
        attributes: { description: cfg.ascDescription },
      },
    });
    if (!r.ok) problems.push(`${pid}: ASC PATCH failed HTTP ${r.status} ${JSON.stringify(r.j?.errors?.[0]?.detail ?? '').slice(0, 160)}`);
    else changes.push(`ASC ${pid} description updated`);
  }
}

console.log(`\n=== ${changes.length} change(s), ${problems.length} problem(s) ===`);
for (const c of changes) console.log(` + ${c}`);
for (const p of problems) console.log(` - ${p}`);
if (!APPLY && problems.length) console.log('\nre-run with --apply to push the expected copy.');
process.exit(problems.length && !changes.length ? 1 : 0);
