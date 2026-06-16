import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Entitlement state — read from the denormalized columns on users
// (subscription_status, premium_active_until, wc_pass_active_until) which the
// RevenueCat webhook keeps current. Single source of truth; the
// react-native-purchases SDK is only used for triggering purchases, not for
// access checks (so a missing RevenueCat key doesn't break gating).
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'none'
  | 'trial'
  | 'active'
  | 'cancelled'
  | 'expired';

export interface EntitlementState {
  status: SubscriptionStatus;
  premiumActiveUntil: Date | null;
  wcPassActiveUntil: Date | null;
  isTrial: boolean;
  isActive: boolean;
  isCancelledOrExpired: boolean;
  hasPremiumAccess: boolean;
  hasWCAccess: boolean;
}

// App-Store / Play-Store review allow-list. Mirrors public.is_reviewer_account()
// in migration 053 — keep these in sync. Reviewer accounts behave like Premium
// users in the UI so they can exercise every create flow, while their DB
// subscription_status stays 'none' so Apple / Google can see the IAP funnel
// when they navigate to Subscription manually.
const REVIEWER_EMAILS = new Set([
  'fansphere.reviewer@gmail.com',
  'reviewer@fansphere.org',
]);

function isReviewerEmail(email: string | null | undefined): boolean {
  return !!email && REVIEWER_EMAILS.has(email.toLowerCase());
}

const DEFAULT_STATE: EntitlementState = {
  status: 'none',
  premiumActiveUntil: null,
  wcPassActiveUntil: null,
  isTrial: false,
  isActive: false,
  isCancelledOrExpired: false,
  hasPremiumAccess: false,
  hasWCAccess: false,
};

function deriveState(row: {
  subscription_status: string | null;
  premium_active_until: string | null;
  wc_pass_active_until: string | null;
} | null): EntitlementState {
  if (!row) return DEFAULT_STATE;
  const now = Date.now();
  const status = (row.subscription_status ?? 'none') as SubscriptionStatus;
  const premiumActiveUntil = row.premium_active_until ? new Date(row.premium_active_until) : null;
  const wcPassActiveUntil = row.wc_pass_active_until ? new Date(row.wc_pass_active_until) : null;

  const isTrial = status === 'trial';
  const isActive = status === 'active';
  const isCancelledOrExpired = status === 'cancelled' || status === 'expired';

  // Mirrors public.has_premium_access() in migration 032 — fail-closed
  // when premium_active_until is null even if status looks active.
  const hasPremiumAccess =
    (isTrial || isActive) &&
    premiumActiveUntil !== null &&
    premiumActiveUntil.getTime() > now;

  // Mirrors public.has_wc_access() — trial includes WC; otherwise an
  // active pass purchase grants WC.
  const hasWCAccess =
    (isTrial && hasPremiumAccess) ||
    (wcPassActiveUntil !== null && wcPassActiveUntil.getTime() > now);

  return {
    status,
    premiumActiveUntil,
    wcPassActiveUntil,
    isTrial,
    isActive,
    isCancelledOrExpired,
    hasPremiumAccess,
    hasWCAccess,
  };
}

export function useSubscriptionState() {
  return useQuery<EntitlementState>({
    queryKey: ['entitlements'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return DEFAULT_STATE;
      const { data, error } = await supabase
        .from('users')
        .select('subscription_status, premium_active_until, wc_pass_active_until')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (error || !data) return DEFAULT_STATE;
      const derived = deriveState(data);
      // Client-side reviewer bypass — mirrors public.has_premium_access /
      // has_wc_access overloads in migration 053. Apple needs the reviewer
      // to see free-tier paywalls when they navigate to Subscription, but
      // also needs them to exercise every create flow so they can validate
      // the app. We grant access at both layers.
      if (isReviewerEmail(user.email)) {
        return { ...derived, hasPremiumAccess: true, hasWCAccess: true };
      }
      return derived;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useHasPremium(): boolean {
  const { data } = useSubscriptionState();
  return data?.hasPremiumAccess ?? false;
}

export function useHasWCAccess(): boolean {
  const { data } = useSubscriptionState();
  return data?.hasWCAccess ?? false;
}

// ---------------------------------------------------------------------------
// Realtime invalidation — when the RevenueCat webhook updates the users row,
// flip the cache so the UI sees the new entitlement state without a refresh.
// Subscribe at the root (app/_layout.tsx) by calling this hook once.
// ---------------------------------------------------------------------------
export function useEntitlementsRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let mounted = true;
    let unsub: (() => void) | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted || !user) return;
      const channel = supabase
        .channel(`entitlements-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `auth_id=eq.${user.id}`,
          },
          () => {
            queryClient.invalidateQueries({ queryKey: ['entitlements'] });
          },
        )
        .subscribe();
      unsub = () => {
        supabase.removeChannel(channel);
      };
    });

    return () => {
      mounted = false;
      unsub?.();
    };
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// RevenueCat SDK init — call once in _layout.tsx. Configures the native SDK
// with the platform-specific publishable key, then logs the current auth
// user in so RevenueCat ties purchases to our auth.users.id. Guards against
// missing keys so the app boots even before the RevenueCat dashboard is
// set up.
// ---------------------------------------------------------------------------
export async function configureRevenueCat(authUserId?: string | null): Promise<void> {
  const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  const apiKey = Platform.OS === 'ios' ? iosKey : androidKey;
  if (!apiKey) {
    if (__DEV__) console.warn('[entitlements] No RevenueCat API key configured for ' + Platform.OS);
    return;
  }
  try {
    // Dynamic require so the native module doesn't break Expo Go / dev
    // environments that don't have it linked.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require('react-native-purchases').default;
    await Purchases.configure({ apiKey });
    if (authUserId) {
      await Purchases.logIn(authUserId);
    }
  } catch (e) {
    if (__DEV__) console.warn('[entitlements] Purchases.configure failed:', e);
  }
}

// Restore purchases — call from the Settings → Subscription screen and from
// paywall sheets. Safe to call when SDK isn't configured (no-op).
export async function restorePurchases(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require('react-native-purchases').default;
    await Purchases.restorePurchases();
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[entitlements] restorePurchases failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Purchase entry points — used by PremiumPaywall + WCPassPaywall.
//
// Both routes hit the RevenueCat native SDK. In Expo Go / dev builds
// without a configured API key, the call fails — there is no dev
// shortcut, because migration 040 locks entitlement columns to
// service_role writes. To render-walk the trial / WC-pass flow in dev,
// grant yourself via the SQL editor (see migration 040 for the snippet).
// ---------------------------------------------------------------------------

export type PurchaseResult =
  | { kind: 'success' }
  | { kind: 'pending' } // dialog closed, awaiting receipt validation
  | { kind: 'cancelled' }
  | { kind: 'error'; error: unknown };

// Find the RC package matching a plan from the current offering. Tries
// multiple identifier strategies so the lookup is resilient to dashboard
// config drift: RC default IDs ($rc_monthly, $rc_annual, $rc_lifetime),
// custom IDs we use (monthly, annual, wc_pass), or product-id match. The
// product-id match is what makes Android work — Play subscription product
// IDs have a `:basePlanId` suffix (e.g. `premium_monthly_999:monthly`)
// that the bare-string purchaseProduct() lookup did not handle, so the
// pre-fix code silently rejected the purchase on every Android device.
async function findPackageForPlan(
  plan: 'monthly' | 'annual' | 'wc_pass',
): Promise<unknown | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require('react-native-purchases').default;
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    const packages: any[] = current?.availablePackages ?? [];
    if (packages.length === 0) return null;

    const defaultRcId =
      plan === 'monthly' ? '$rc_monthly'
      : plan === 'annual' ? '$rc_annual'
      : '$rc_lifetime';
    const customRcId = plan === 'wc_pass' ? 'wc_pass' : plan;
    const productId =
      plan === 'monthly' ? 'premium_monthly_999'
      : plan === 'annual' ? 'premium_annual_10788'
      : 'wc_pass_2026';

    return (
      packages.find((p) => p.identifier === defaultRcId) ??
      packages.find((p) => p.identifier === customRcId) ??
      packages.find((p) => {
        const pid: string = p.product?.identifier ?? '';
        return pid === productId || pid.startsWith(productId + ':');
      }) ??
      null
    );
  } catch (e) {
    if (__DEV__) console.warn('[entitlements] findPackageForPlan failed:', e);
    return null;
  }
}

export async function purchasePremium(plan: 'monthly' | 'annual'): Promise<PurchaseResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require('react-native-purchases').default;
    const pkg = await findPackageForPlan(plan);
    if (!pkg) {
      return {
        kind: 'error',
        error: new Error(
          `No matching ${plan} package in current RevenueCat offering`,
        ),
      };
    }
    const result = await Purchases.purchasePackage(pkg);
    if (result?.customerInfo?.entitlements?.active?.premium) {
      return { kind: 'success' };
    }
    return { kind: 'pending' };
  } catch (e: any) {
    if (e?.userCancelled || /cancel/i.test(e?.message ?? '')) {
      return { kind: 'cancelled' };
    }
    return { kind: 'error', error: e };
  }
}

export async function purchaseWCPass(): Promise<PurchaseResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Purchases = require('react-native-purchases').default;

    // WC Pass is a non-consumable, NOT a subscription, so it doesn't
    // need the productId:basePlanId Android-subscription handling that
    // Premium uses. Try the package path first (works if the RC dashboard
    // has it in the current offering), and fall back to a direct product
    // purchase by bare product ID, which works on both iOS and Android
    // for non-consumables. This recovers from RC offering misconfigurations
    // — observed 2026-06-15 when findPackageForPlan kept returning null
    // even with an Active wc_pass_2026 IAP in Play Console.
    const pkg = await findPackageForPlan('wc_pass');
    const result = pkg
      ? await Purchases.purchasePackage(pkg)
      : await Purchases.purchaseProduct('wc_pass_2026');

    if (result?.customerInfo?.entitlements?.active?.wc_pass) {
      return { kind: 'success' };
    }
    return { kind: 'pending' };
  } catch (e: any) {
    if (e?.userCancelled || /cancel/i.test(e?.message ?? '')) {
      return { kind: 'cancelled' };
    }
    return { kind: 'error', error: e };
  }
}
