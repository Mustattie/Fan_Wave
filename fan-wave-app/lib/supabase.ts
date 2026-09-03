import { createClient } from '@supabase/supabase-js';
import { Alert, AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { reportError } from '@/lib/errorReporting';

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
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
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

    try {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
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
