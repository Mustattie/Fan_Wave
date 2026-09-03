#!/usr/bin/env node
// Configure the RevenueCat project for the v9.3 tiered model, iOS + Android,
// via the RevenueCat REST API v2.
//
// This is the FW-89 half of docs/monetization-setup.md, executed instead of
// clicked. It creates:
//
//   8 products    4 SKUs x 2 platforms (RC products are per-app, not per-SKU)
//   2 entitlements  home_team, mvp
//   1 offering    `default`, set current
//   4 packages    home_team_monthly/annual, mvp_monthly/annual
//
// and attaches products to both the entitlements and the packages, exactly as
// lib/entitlements.ts expects to find them:
//
//   TIER_PRODUCT_IDS      -> product store_identifiers below
//   TIER_ENTITLEMENT_ID   -> entitlement lookup_keys below (note MVP is additive:
//                            the mvp_* SKUs attach to `home_team` as well)
//   findPackageForTierPlan -> package identifiers `{tier}_{plan}`
//
// PREREQUISITE, NOT OPTIONAL: the four subscriptions must already exist in App
// Store Connect and Google Play (FW-88). RevenueCat products are pointers to
// store products. Creating the RC rows against SKUs the stores don't have gives
// you packages with no price, so getTierPrice() still returns { available: false }
// and the paywall still reads "Plans are temporarily unavailable". Run this after
// the stores, not before.
//
// USAGE
//   # dry run — prints every call it would make, writes nothing
//   RC_SECRET_KEY=sk_xxx RC_PROJECT_ID=proj_xxx node scripts/setup-revenuecat.mjs
//
//   # apply
//   RC_SECRET_KEY=sk_xxx RC_PROJECT_ID=proj_xxx node scripts/setup-revenuecat.mjs --apply
//
// The key must be a **v2 secret key** (dashboard: Project settings -> API keys ->
// New API key) with read_write on project_configuration for products,
// entitlements, offerings and packages. The `appl_` / `goog_` keys in eas.json are
// public SDK keys: they can read offerings and nothing else. v1 keys are rejected
// by the v2 API.
//
// Idempotent: everything is GET-first and matched on lookup_key / identifier /
// store_identifier, so re-running after a partial failure resumes rather than
// duplicating. Safe to run repeatedly.

const API = 'https://api.revenuecat.com/v2';

const SECRET = process.env.RC_SECRET_KEY;
const PROJECT_ID = process.env.RC_PROJECT_ID;
const APPLY = process.argv.includes('--apply');

if (!SECRET || !PROJECT_ID) {
  console.error('RC_SECRET_KEY and RC_PROJECT_ID are both required.\n');
  console.error('  RC_SECRET_KEY   v2 secret key, starts with sk_ (NOT the appl_/goog_ SDK keys)');
  console.error('  RC_PROJECT_ID   starts with proj_; RevenueCat dashboard URL or Project settings');
  process.exit(2);
}
if (!SECRET.startsWith('sk_')) {
  console.error(`RC_SECRET_KEY does not look like a v2 secret key (got "${SECRET.slice(0, 6)}...").`);
  console.error('The appl_/goog_ keys in eas.json are public SDK keys and cannot write. Aborting');
  console.error('rather than firing 8 doomed POSTs at the API.');
  process.exit(2);
}

// ─── The model. Prices live in the stores, not here — since v9.4.5 the paywall
//     renders the package's own priceString, so there is deliberately nothing
//     price-shaped in this file to drift out of sync. ────────────────────────
const SKUS = [
  { tier: 'home_team', plan: 'monthly', sku: 'home_team_monthly_499', basePlan: 'monthly' },
  { tier: 'home_team', plan: 'annual', sku: 'home_team_annual_3499', basePlan: 'annual' },
  { tier: 'mvp', plan: 'monthly', sku: 'mvp_monthly_1499', basePlan: 'monthly' },
  { tier: 'mvp', plan: 'annual', sku: 'mvp_annual_9999', basePlan: 'annual' },
];

// Play addresses a subscription as `{productId}:{basePlanId}`; the App Store
// uses the bare product ID. Not cosmetic -- this project's existing rows are
// `premium_monthly_999:monthly` (android) against `premium_monthly_999` (ios).
// A bare android store_identifier points at a Play SKU that does not exist, so
// the package resolves with no price, getTierPrice() returns
// { available: false }, and the paywall stays "Unavailable" -- the exact
// failure this script exists to end.
//
// basePlan must match the base plan ID typed into Play Console. If a base plan
// was named something other than monthly/annual, fix it here first.
const BASE_PLAN = Object.fromEntries(SKUS.map((s) => [s.sku, s.basePlan]));
const storeIdFor = (sku, platform) =>
  platform === 'android' ? `${sku}:${BASE_PLAN[sku]}` : sku;

const DISPLAY_NAME = {
  home_team_monthly_499: 'Home Team (Monthly)',
  home_team_annual_3499: 'Home Team (Annual)',
  mvp_monthly_1499: 'MVP (Monthly)',
  mvp_annual_9999: 'MVP (Annual)',
};

// home_team carries the mvp_* SKUs too: MVP is additive, and purchaseTier('mvp')
// accepts either `mvp` or `home_team` as its success signal. Getting this wrong
// is how an MVP subscriber loses every Home Team perk.
const ENTITLEMENTS = [
  {
    lookup_key: 'home_team',
    display_name: 'Home Team',
    skus: ['home_team_monthly_499', 'home_team_annual_3499', 'mvp_monthly_1499', 'mvp_annual_9999'],
  },
  {
    lookup_key: 'mvp',
    display_name: 'MVP',
    skus: ['mvp_monthly_1499', 'mvp_annual_9999'],
  },
];

const OFFERING = { identifier: 'default', display_name: 'Fan Sphere Plans' };

let changes = 0;
let skipped = 0;

async function rc(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body — keep the text for the message below
  }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text.slice(0, 400);
    throw new Error(`${method} ${path} -> ${res.status} ${detail}`);
  }
  return json;
}

// GET a paginated v2 collection in full.
async function listAll(path) {
  const out = [];
  let url = `${path}${path.includes('?') ? '&' : '?'}limit=50`;
  for (;;) {
    const page = await rc('GET', url);
    out.push(...(page?.items ?? []));
    const next = page?.next_page;
    if (!next) return out;
    // next_page comes back as a v2-relative path already carrying the cursor.
    url = next.replace(/^\/v2/, '');
  }
}

function plan(label) {
  changes++;
  console.log(`  ${APPLY ? 'CREATE' : 'would create'}  ${label}`);
}
function have(label) {
  skipped++;
  console.log(`  exists       ${label}`);
}

async function main() {
  console.log(`RevenueCat project ${PROJECT_ID}`);
  console.log(APPLY ? 'mode: APPLY — this writes to the dashboard\n' : 'mode: DRY RUN — nothing will be written\n');

  // ─── Apps. RC products are per-app, so the iOS and Android app IDs are the
  //     spine of everything below. ─────────────────────────────────────────
  console.log('apps');
  const apps = await listAll(`/projects/${PROJECT_ID}/apps`);
  if (apps.length === 0) {
    throw new Error(
      'project has no apps. Add the iOS app (bundle org.fansphere.app) and the ' +
        'Android app (package org.fansphere.app) in the RevenueCat dashboard first — ' +
        'they need store credentials attached, which this script cannot upload.',
    );
  }
  const ios = apps.find((a) => a.type === 'app_store' || a.type === 'ios');
  const android = apps.find((a) => a.type === 'play_store' || a.type === 'android');
  for (const [label, app] of [['ios', ios], ['android', android]]) {
    if (!app) {
      throw new Error(
        `no ${label} app in this project (found: ${apps.map((a) => `${a.name}/${a.type}`).join(', ')}). ` +
          `Both platforms must exist before products can be attached.`,
      );
    }
    console.log(`  ${label.padEnd(8)} ${app.id}  ${app.name}`);
  }
  const targets = [
    { label: 'ios', app: ios },
    { label: 'android', app: android },
  ];

  // ─── Products: 4 SKUs x 2 apps. ────────────────────────────────────────
  console.log('\nproducts');
  const existingProducts = await listAll(`/projects/${PROJECT_ID}/products`);
  // store_identifier -> { app_id -> product_id }, so later attach steps can
  // resolve a SKU to its per-platform RC product IDs.
  const productIds = {};
  for (const { sku } of SKUS) {
    productIds[sku] = {};
    for (const { label, app } of targets) {
      const storeId = storeIdFor(sku, label);
      const found = existingProducts.find(
        (p) => p.store_identifier === storeId && p.app_id === app.id,
      );
      if (found) {
        productIds[sku][app.id] = found.id;
        have(`product ${storeId} (${label})`);
        continue;
      }
      plan(`product ${storeId} (${label})`);
      if (APPLY) {
        const created = await rc('POST', `/projects/${PROJECT_ID}/products`, {
          store_identifier: storeId,
          app_id: app.id,
          type: 'subscription',
          display_name: DISPLAY_NAME[sku],
        });
        productIds[sku][app.id] = created.id;
      }
    }
  }

  // Resolve a SKU list to concrete RC product IDs across both platforms.
  // In dry run the IDs don't exist yet, so attach steps report intent only.
  const idsFor = (skus) =>
    skus.flatMap((sku) => targets.map(({ app }) => productIds[sku]?.[app.id]).filter(Boolean));

  // ─── Entitlements + attachments. ───────────────────────────────────────
  console.log('\nentitlements');
  const existingEnts = await listAll(`/projects/${PROJECT_ID}/entitlements`);
  for (const ent of ENTITLEMENTS) {
    let row = existingEnts.find((e) => e.lookup_key === ent.lookup_key);
    if (row) {
      have(`entitlement ${ent.lookup_key}`);
    } else {
      plan(`entitlement ${ent.lookup_key}`);
      if (APPLY) {
        row = await rc('POST', `/projects/${PROJECT_ID}/entitlements`, {
          lookup_key: ent.lookup_key,
          display_name: ent.display_name,
        });
      }
    }

    const wanted = idsFor(ent.skus);
    if (!APPLY) {
      console.log(`  would attach ${ent.skus.length * 2} products to ${ent.lookup_key} (${ent.skus.join(', ')})`);
      continue;
    }
    // Attach is additive and tolerates already-attached products, but filter
    // anyway so the log says something true.
    const attached = new Set(
      (await listAll(`/projects/${PROJECT_ID}/entitlements/${row.id}/products`)).map((p) => p.id),
    );
    const todo = wanted.filter((id) => !attached.has(id));
    if (todo.length === 0) {
      have(`${ent.lookup_key} product attachments (${attached.size})`);
    } else {
      plan(`attach ${todo.length} products to ${ent.lookup_key}`);
      await rc('POST', `/projects/${PROJECT_ID}/entitlements/${row.id}/actions/attach_products`, {
        product_ids: todo,
      });
    }
  }

  // ─── Offering `default`, current. The client reads offerings.current only. ──
  console.log('\noffering');
  const offerings = await listAll(`/projects/${PROJECT_ID}/offerings`);
  let offering = offerings.find((o) => o.lookup_key === OFFERING.identifier || o.identifier === OFFERING.identifier);
  if (offering) {
    have(`offering ${OFFERING.identifier}${offering.is_current ? ' (current)' : ''}`);
    if (!offering.is_current) {
      plan(`mark ${OFFERING.identifier} as current`);
      if (APPLY) {
        await rc('POST', `/projects/${PROJECT_ID}/offerings/${offering.id}`, { is_current: true });
      }
    }
  } else {
    plan(`offering ${OFFERING.identifier} (current)`);
    if (APPLY) {
      offering = await rc('POST', `/projects/${PROJECT_ID}/offerings`, {
        lookup_key: OFFERING.identifier,
        display_name: OFFERING.display_name,
        is_current: true,
      });
    }
  }

  // ─── Packages. Identifier `{tier}_{plan}` is the first thing
  //     findPackageForTierPlan looks for. ──────────────────────────────────
  console.log('\npackages');
  const existingPkgs = offering?.id
    ? await listAll(`/projects/${PROJECT_ID}/offerings/${offering.id}/packages`)
    : [];
  for (const { tier, plan: term, sku } of SKUS) {
    const identifier = `${tier}_${term}`;
    let pkg = existingPkgs.find((p) => p.lookup_key === identifier || p.identifier === identifier);
    if (pkg) {
      have(`package ${identifier}`);
    } else {
      plan(`package ${identifier}`);
      if (APPLY) {
        pkg = await rc('POST', `/projects/${PROJECT_ID}/offerings/${offering.id}/packages`, {
          lookup_key: identifier,
          display_name: DISPLAY_NAME[sku],
        });
      }
    }

    if (!APPLY) {
      console.log(`  would attach ${sku} (ios + android) to ${identifier}`);
      continue;
    }
    const wanted = idsFor([sku]);
    const attached = new Set(
      // NB: package products hang off /projects/{p}/packages/{id}, NOT under
      // the offering. The nested path 404s.
      (await listAll(`/projects/${PROJECT_ID}/packages/${pkg.id}/products`))
        .map((p) => p.id ?? p.product?.id)
        .filter(Boolean),
    );
    const todo = wanted.filter((id) => !attached.has(id));
    if (todo.length === 0) {
      have(`${identifier} product attachments (${attached.size})`);
    } else {
      plan(`attach ${sku} (${todo.length} platform rows) to ${identifier}`);
      await rc(
        'POST',
        `/projects/${PROJECT_ID}/packages/${pkg.id}/actions/attach_products`,
        { products: todo.map((id) => ({ product_id: id, eligibility_criteria: 'all' })) },
      );
    }
  }

  console.log(
    `\n${APPLY ? 'applied' : 'planned'}: ${changes} change(s), ${skipped} already in place`,
  );
  if (!APPLY) {
    console.log('re-run with --apply to write.');
    return;
  }

  // ─── Verify by reading back what a device would read. ──────────────────
  console.log('\nverify');
  const pkgs = await listAll(`/projects/${PROJECT_ID}/offerings/${offering.id}/packages`);
  const want = SKUS.map(({ tier, plan: term }) => `${tier}_${term}`);
  const got = pkgs.map((p) => p.lookup_key ?? p.identifier);
  const missing = want.filter((w) => !got.includes(w));
  if (missing.length) {
    console.log(`  ✗ offering is missing packages: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`  ✓ offering ${OFFERING.identifier} serves all 4 packages: ${got.join(', ')}`);
  console.log('\nRemaining, and it cannot be done from here:');
  console.log('  - the four subscriptions must exist and be Active/Ready in App Store');
  console.log('    Connect + Google Play, with the 7-day trial on home_team_* only');
  console.log('  - store credentials uploaded to RevenueCat for receipt validation');
  console.log('  - webhook -> https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/revenuecat-webhook');
  console.log('  then confirm on a real device: prices render instead of "Unavailable",');
  console.log('  and the charged price matches the displayed one.');
}

main().catch((e) => {
  console.error(`\nfailed: ${e.message}`);
  console.error('\nNothing is half-created in a way a re-run cannot fix: every step is');
  console.error('GET-first and matched on lookup_key/store_identifier. Fix the cause and');
  console.error('run again.');
  process.exit(1);
});
