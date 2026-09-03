/**
 * Which active Play subscription a new purchase replaces, and whether that
 * replacement is an upgrade.
 *
 * WHY THIS EXISTS
 *
 * The App Store keeps all four Fan Sphere SKUs in one subscription group, so
 * it turns Home Team -> MVP into a managed upgrade on its own: the old
 * subscription ends, the new one starts, one charge.
 *
 * Google Play has no subscription groups. Four SKUs are four independent
 * subscriptions, and buying a second while the first is live leaves BOTH
 * active. Play raises no error, shows no warning, and RevenueCat reports two
 * active subscriptions — the user discovers it on their card. Before this
 * module, `purchaseTier` called `purchasePackage(pkg)` with no product-change
 * info, so every Android tier change did exactly that.
 *
 * Play needs to be told what the purchase replaces. This module decides the
 * `oldProductIdentifier` and the direction; `entitlements.ts` maps the
 * direction onto a STORE_REPLACEMENT_MODE and hands it to the SDK.
 *
 * Kept free of react-native / supabase imports so it can be unit-tested
 * directly — the decision is the part worth testing, and it is pure.
 */

/**
 * Ordering used to answer "is this an upgrade or a downgrade".
 *
 * Tier dominates; term breaks the tie, with annual outranking monthly so a
 * monthly -> annual switch within a tier takes effect immediately rather than
 * being deferred to the next renewal.
 *
 * Legacy `premium_*` products rank as MVP because that is what the webhook
 * grandfathers them to (`productToTier`, revenuecat-webhook/index.ts). Ranking
 * them any lower would let a grandfathered subscriber "upgrade" to a tier they
 * already effectively hold, and be charged for it.
 */
const PRODUCT_RANK: Record<string, number> = {
  home_team_monthly_499: 10,
  home_team_annual_3499: 11,
  mvp_monthly_1499: 20,
  mvp_annual_9999: 21,
  premium_monthly_999: 20,
  premium_annual_10788: 21,
};

/**
 * Play reports subscriptions as `productId:basePlanId`
 * (`home_team_monthly_499:monthly`); the App Store sends the bare product ID.
 * Every lookup here strips the suffix — the same normalisation the webhook does
 * with `productId.split(":")[0]`.
 */
export function baseProductId(storeIdentifier: string): string {
  return storeIdentifier.split(':')[0];
}

export interface AndroidReplacement {
  /** Passed to Play as-is, suffix included — it identifies the live purchase. */
  oldProductIdentifier: string;
  /** true -> replace immediately with prorated credit; false -> defer to renewal. */
  isUpgrade: boolean;
}

/**
 * @param activeStoreIds `customerInfo.activeSubscriptions`, verbatim.
 * @param targetProductId the bare product ID being purchased.
 * @returns the replacement to declare, or null when this is a plain new
 *          subscription.
 *
 * Null matters in both directions: returning null while a subscription is
 * active is the double-bill bug, and returning a replacement when nothing is
 * active makes Play reject the purchase outright.
 */
export function chooseAndroidReplacement(
  activeStoreIds: string[],
  targetProductId: string,
): AndroidReplacement | null {
  // Re-purchasing the product you already hold is not a replacement, and Play
  // rejects replacing a subscription with itself.
  const others = activeStoreIds.filter((id) => baseProductId(id) !== targetProductId);
  if (others.length === 0) return null;

  const rankOf = (storeId: string) => PRODUCT_RANK[baseProductId(storeId)] ?? -1;

  // An account that already hit this bug carries more than one. Replace the
  // most valuable — replacing the cheap one would leave the expensive one
  // billing, which is the worse half of the same problem.
  const old = others.reduce((best, id) => (rankOf(id) > rankOf(best) ? id : best));

  return {
    oldProductIdentifier: old,
    // An unrecognised active product ranks -1, so anything known counts as an
    // upgrade against it. That is the safe default: an immediate switch cannot
    // leave two subscriptions running, whereas a deferred one against an
    // unknown product could.
    isUpgrade: (PRODUCT_RANK[targetProductId] ?? -1) > rankOf(old),
  };
}
