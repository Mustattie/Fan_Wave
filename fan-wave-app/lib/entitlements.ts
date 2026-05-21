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
      return deriveState(data);
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
