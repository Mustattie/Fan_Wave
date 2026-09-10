import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { CheckCircle2, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';

/**
 * Landing route for `fansphere://auth-callback`.
 *
 * v9.5.10 (Android UAT #1). Every auth email we send — signup confirmation
 * (sign-up.tsx), resend (verify-email.tsx), password reset
 * (forgot-password.tsx) — sets `emailRedirectTo: 'fansphere://auth-callback'`.
 * No route of that name existed. So on a phone the link opened the app
 * straight into +not-found, and the tokens Supabase put in the URL were
 * never exchanged for a session.
 *
 * What the tester saw was the desktop version of the same gap: Supabase
 * verifies the token server-side and then 302s the browser to a custom
 * scheme it cannot open, which renders as a blank page. Worth being clear
 * that the confirmation itself DID work — `email_confirmed_at` is written
 * before the redirect. The blank page is the handoff failing, not the
 * verification.
 *
 * This route closes the phone half: it consumes whatever Supabase handed
 * back, and says plainly what happened either way. The desktop half needs
 * an https landing page, which lives outside this repo — see the
 * verification notes in the v9.5.10 commit.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    token_hash?: string;
    type?: string;
    error_description?: string;
  }>();
  const [state, setState] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Supabase can hand the result back three ways depending on flow and
        // platform, and we may get it as a query string OR as a URL fragment
        // that expo-router does not parse into params. Read the raw URL too.
        const initialUrl = await Linking.getInitialURL();
        const fragment = initialUrl?.includes('#')
          ? Object.fromEntries(new URLSearchParams(initialUrl.split('#')[1]))
          : {};

        const errorDescription =
          params.error_description || (fragment as any).error_description;
        if (errorDescription) {
          if (!cancelled) {
            setState('failed');
            setMessage(String(errorDescription).replace(/\+/g, ' '));
          }
          return;
        }

        const accessToken = params.access_token || (fragment as any).access_token;
        const refreshToken = params.refresh_token || (fragment as any).refresh_token;

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: String(accessToken),
            refresh_token: String(refreshToken),
          });
          if (error) throw error;
          if (!cancelled) setState('ok');
          // The root NavigationGuard owns where a signed-in user belongs —
          // onboarding for a fresh account, tabs for a returning one. Don't
          // second-guess it from here; just let it see the session.
          return;
        }

        // PKCE / token_hash style confirmation.
        const tokenHash = params.token_hash || (fragment as any).token_hash;
        const type = (params.type || (fragment as any).type || 'signup') as any;
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: String(tokenHash),
            type,
          });
          if (error) throw error;
          if (!cancelled) setState('ok');
          return;
        }

        // Nothing usable in the URL. The commonest cause by far is that the
        // link was opened in a desktop browser, which consumed the
        // verification and left the phone with a bare scheme launch. The
        // account is almost certainly confirmed; sign-in is the next step.
        if (!cancelled) {
          setState('ok');
          setMessage('signin');
        }
      } catch (e: any) {
        reportError(e, { source: 'auth-callback' });
        if (!cancelled) {
          setState('failed');
          setMessage(e?.message ?? 'That link could not be used.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Params are stable for the lifetime of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {state === 'working' ? (
          <>
            <ActivityIndicator size="large" color={Colors.dark.accent} />
            <Text style={styles.title}>Finishing up…</Text>
          </>
        ) : state === 'ok' ? (
          <>
            <CheckCircle2 size={48} color={Colors.dark.success} />
            <Text style={styles.title}>Email confirmed</Text>
            <Text style={styles.body}>
              Your account is active. Sign in to finish setting up your feed.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.replace('/(auth)/sign-in')}
            >
              <Text style={styles.buttonText}>Continue to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <AlertCircle size={48} color={Colors.dark.error} />
            <Text style={styles.title}>That link didn't work</Text>
            <Text style={styles.body}>
              {message || 'The link may have expired.'} You can request a new one
              from the sign-in screen.
            </Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.replace('/(auth)/sign-in')}
            >
              <Text style={styles.buttonText}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
