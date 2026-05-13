import { createClient } from '@supabase/supabase-js';
import { Alert, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { reportError } from '@/lib/errorReporting';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

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

/**
 * Handle deep link auth callbacks (email confirmation, password reset).
 * Call once in the root layout.
 */
export function setupAuthDeepLinkHandler(): () => void {
  const handleUrl = async (event: { url: string }) => {
    const url = event.url;
    if (!url) return;
    if (!url.startsWith('fanwave://')) return; // Ignore unrelated deep links

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
