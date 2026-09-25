import { createClient } from '@supabase/supabase-js';
import { Alert, AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { User } from '@supabase/supabase-js';
import { reportError, addBreadcrumb } from '@/lib/errorReporting';
import { createResilientFetch } from '@/lib/authFetch';
import { claimAuthLink } from '@/lib/authLinkClaims';
import { markRecoveryPending } from '@/lib/authRecovery';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Fail fast if a build was produced with unresolved placeholder credentials.
 * This catches builds where the env-swap runbook step was skipped — without
 * this guard the app would silently connect to a non-existent host and every
 * query would time out with no clear root cause.
 *
 * Dev / preview flows are unaffected because they ship real values via .env
 * and the `preview` EAS profile.
 */
function assertSupabaseEnvConfigured(url: string | undefined, key: string | undefined): void {
  const placeholderTokens = ['__SET_', 'YOUR_PRODUCTION', 'YOUR_STAGING'];
  const isPlaceholder = (value: string | undefined): boolean => {
    if (!value) return true;
    return placeholderTokens.some((token) => value.includes(token));
  };

  if (isPlaceholder(url) || isPlaceholder(key)) {
    throw new Error(
      '[supabase] Misconfigured build: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
        'still contain placeholder tokens (__SET_…, YOUR_PRODUCTION_…, YOUR_STAGING_…) or are empty. ' +
        'Replace them in eas.json / .env.production before building. ' +
        'See docs/env-swap-runbook.md.',
    );
  }
}

assertSupabaseEnvConfigured(supabaseUrl, supabaseAnonKey);

const getStorage = () => {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  }
  // AsyncStorage for native platforms - lazy import to avoid SSR issues
  return require('@react-native-async-storage/async-storage').default;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    // Phase 1 (2026-09-16): a 429 on the token endpoint must not become a
    // sign-out. See lib/authFetch.ts. Wrapped in an arrow so the global
    // fetch is looked up at call time, not at module load.
    fetch: createResilientFetch((input, init) => fetch(input, init)),
  },
  realtime: {
    // P2.3 (2026-09-25): realtime-js reconnects on a fixed 1/2/5/10 s
    // ladder, so every device that lost the same socket re-joins in the
    // same second. Same ladder, spread over [step, 1.5 x step).
    reconnectAfterMs: (tries: number) => {
      const step = [1000, 2000, 5000, 10000][tries - 1] ?? 10000;
      return Math.floor(step + Math.random() * step * 0.5);
    },
  },
});

// v9.5.5: bridge AppState into the auth auto-refresh timer.
//
// This is a documented requirement for supabase-js on React Native and it was
// never wired up. autoRefreshToken schedules a JS timer, and Android suspends
// JS timers while the app is backgrounded -- so the refresh that should have
// happened at minute 55 simply does not, and the access token can be expired
// by the time the user comes back.
//
// Posting a clip is exactly the flow that backgrounds the app: the camera or
// the media picker is a separate activity, and a user can easily spend minutes
// there. On return, the first authed call races a refresh against an already
// expired token.
//
// startAutoRefresh() on foreground makes the client refresh immediately on
// resume instead of waiting for a timer that never fired; stopAutoRefresh()
// on background stops it burning cycles and attempting refreshes that cannot
// complete.
// P2.12 (2026-09-25): startAutoRefresh() refreshes immediately when the
// token is inside its expiry margin. At a kickoff, every phone that was
// backgrounded through the pre-game comes back within the same seconds
// and every one of them refreshes at once behind the venue's NAT (150
// refreshes / 5 min / IP). Spread the resume refresh over 0-2 s. A
// call that needs the session sooner still works: auth-js refreshes on
// demand when getSession() sees an expired token.
const RESUME_REFRESH_SPREAD_MS = 2_000;
let resumeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      if (resumeRefreshTimer) clearTimeout(resumeRefreshTimer);
      resumeRefreshTimer = setTimeout(() => {
        resumeRefreshTimer = null;
        supabase.auth.startAutoRefresh();
      }, Math.floor(Math.random() * RESUME_REFRESH_SPREAD_MS));
    } else {
      if (resumeRefreshTimer) {
        clearTimeout(resumeRefreshTimer);
        resumeRefreshTimer = null;
      }
      supabase.auth.stopAutoRefresh();
    }
  });
  // The listener only fires on CHANGES, so prime it for the current state.
  if (AppState.currentState === 'active') {
    supabase.auth.startAutoRefresh();
  }
}

/**
 * Handle deep link auth callbacks (email confirmation, password reset).
 * Call once in the root layout.
 */
export function setupAuthDeepLinkHandler(): () => void {
  const handleUrl = async (event: { url: string }) => {
    const url = event.url;
    if (!url) return;
    if (!url.startsWith('fansphere://')) return; // Ignore unrelated deep links

    // Supabase may return an auth error in the fragment instead of tokens.
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return;

    const fragment = url.substring(hashIndex + 1);
    const params = new URLSearchParams(fragment);

    const errorCode = params.get('error_code') || params.get('error');
    const errorDesc = params.get('error_description');
    if (errorCode) {
      const friendly = explainAuthLinkError(errorCode, errorDesc);
      Alert.alert(friendly.title, friendly.message);
      return;
    }

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    // Stability fix 8: app/auth-callback may already have exchanged these
    // tokens (or will, if it runs first). One setSession per link.
    if (!claimAuthLink(accessToken)) {
      addBreadcrumb('auth', 'link.already_claimed', { by: 'deepLinkHandler' });
      return;
    }

    try {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
      addBreadcrumb('auth', 'link.consumed', { by: 'deepLinkHandler', type: params.get('type') ?? null });
      routeAfterAuthLink(params.get('type'));
    } catch (e) {
      reportError(e, { source: 'supabase:setupAuthDeepLinkHandler' });
      Alert.alert(
        'Sign-in link failed',
        'We could not complete the sign-in. The link may have expired — please request a new one.',
      );
    }
  };

  // Handle the URL that opened the app (cold start)
  Linking.getInitialURL().then((url) => {
    if (url) handleUrl({ url });
  });

  // Handle URLs while app is running (warm start)
  const subscription = Linking.addEventListener('url', handleUrl);
  return () => subscription.remove();
}

/**
 * Where a consumed auth link should land. A password-recovery link used
 * to sign the user straight into the tabs: the app waited for a
 * PASSWORD_RECOVERY event, but supabase-js only emits that when it parses
 * the URL itself (detectSessionInUrl, disabled here); a manual setSession
 * emits SIGNED_IN. The link's own `type=recovery` marker is the signal.
 * Confirmation / magic links fall through to NavigationGuard as before.
 */
export function routeAfterAuthLink(type: string | null | undefined): void {
  if (type !== 'recovery') return;
  // Build 28 UAT: the replace below is only a fast path. NavigationGuard
  // reads this flag and keeps the user on reset-password until the
  // password is changed (lib/authRecovery.ts); without it the guard's
  // signed-in branch replaced this route with the tabs.
  markRecoveryPending();
  try {
    // require() to avoid a circular import at module-load time (the
    // router imports screens that import this module).
    const { router } = require('expo-router');
    router.replace('/(auth)/reset-password');
  } catch {
    /* Router not ready — the user can still navigate manually. */
  }
}

/**
 * The signed-in user from the locally persisted session, without a
 * network round-trip (stability fix 9). supabase.auth.getUser() validates
 * the JWT against the server on every call; the app called it from 54
 * places just to learn its own user id, which cost a request each time,
 * bunched into a burst on every resume, and turned every one of those
 * sites into a sign-out trigger the moment a session was revoked
 * server-side. Screens that only need `id` / `email` / metadata use this;
 * flows that must validate the session (sign-in, sign-up, account
 * deletion, boot) keep getUser().
 *
 * getSession() refreshes an expired-with-margin token itself, so the user
 * returned here is the one the next authenticated request will act as.
 */
export async function getSessionUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

/** Same as getSessionUser, in getUser()'s `{ data: { user } }` shape. */
export async function getLocalUser(): Promise<{ data: { user: User | null }; error: null }> {
  return { data: { user: await getSessionUser() }, error: null };
}

function explainAuthLinkError(
  code: string,
  description: string | null,
): { title: string; message: string } {
  const c = code.toLowerCase();
  if (c.includes('expired') || c === 'otp_expired') {
    return {
      title: 'Link expired',
      message: 'That sign-in link has expired. Request a new one from the sign-in screen.',
    };
  }
  if (c.includes('invalid') || c === 'access_denied') {
    return {
      title: 'Invalid link',
      message: 'That sign-in link is no longer valid. Please request a new one.',
    };
  }
  return {
    title: 'Sign-in link failed',
    message: description?.replace(/\+/g, ' ') ?? 'Please try requesting a new link.',
  };
}
