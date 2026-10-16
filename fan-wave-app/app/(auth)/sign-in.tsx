import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { markIntentionalSignOut } from '@/lib/authTelemetry';
import { AUTH_REDIRECT_URL } from '@/lib/authRedirect';
import { parseAuthError } from '@/lib/authErrors';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';

export default function SignInScreen() {
  const router = useRouter();
  // v9.5.10 (#2): verify-email and auth-callback hand the address over so
  // someone who has just confirmed only has to type a password.
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(emailParam ? String(emailParam) : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // SKYC-136: the address whose confirmation is outstanding. Set by
  // whichever unconfirmed-email branch fired, and it keeps the resend
  // control on screen after the alert is dismissed -- an alert button is
  // a one-shot offer, and the user who dismisses it to go check their
  // inbox comes back to a screen with no way to ask again.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  // One resend path for both unconfirmed branches (error-with-no-session,
  // and session-without-email_confirmed_at). They used to differ: only
  // the second had a Resend button at all.
  const resendConfirmation = useCallback(async (target: string) => {
    setResending(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: target,
        options: {
          emailRedirectTo: AUTH_REDIRECT_URL,
        },
      });
      if (resendError) throw resendError;
      Alert.alert('Email sent', `We sent a new confirmation link to ${target}.`);
    } catch (resendErr) {
      const info = parseAuthError(resendErr);
      Alert.alert(info.title, info.message);
    } finally {
      setResending(false);
    }
  }, []);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    const trimmedEmail = email.trim();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) throw error;

      // Gate access until email is confirmed. If Confirm Email is on,
      // an unconfirmed user shouldn't have a usable session.
      if (data.session && !data.session.user.email_confirmed_at) {
        markIntentionalSignOut();
        await supabase.auth.signOut();
        setUnconfirmedEmail(trimmedEmail);
        Alert.alert(
          'Email not verified',
          'Please verify your email first. Check your inbox for the confirmation link.',
          [
            {
              text: 'Resend',
              onPress: () => {
                void resendConfirmation(trimmedEmail);
              },
            },
            { text: 'OK', style: 'cancel' },
          ],
        );
        return;
      }
      // A clean sign-in clears any earlier unconfirmed state.
      setUnconfirmedEmail(null);
    } catch (e) {
      const info = parseAuthError(e);
      // SKYC-136: with Confirm Email enabled, signInWithPassword fails
      // with code `email_not_confirmed` and no session, so this is the
      // branch real users hit -- and it used to show a message promising
      // a resend control that only existed on the other branch. Offer
      // the resend here, and leave it on the screen afterwards.
      if (info.action === 'resend_confirmation') {
        setUnconfirmedEmail(trimmedEmail);
        Alert.alert(info.title, info.message, [
          {
            text: 'Resend link',
            onPress: () => {
              void resendConfirmation(trimmedEmail);
            },
          },
          { text: 'Not now', style: 'cancel' },
        ]);
        return;
      }
      Alert.alert(info.title, info.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={styles.content}
    >
        <View style={styles.logoSection}>
          <Text style={styles.logo}>Fan Sphere</Text>
          <Text style={styles.wave}>{'🌐'}</Text>
          <Text style={styles.tagline}>Your crew, any city, every game.</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Mail size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Colors.dark.textMuted}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                // The resend row names an address; if the field no longer
                // holds it, the row must go rather than silently resend
                // to the old one.
                if (unconfirmedEmail && text.trim() !== unconfirmedEmail) {
                  setUnconfirmedEmail(null);
                }
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Lock size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.dark.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              {showPassword ? (
                <EyeOff size={18} color={Colors.dark.textMuted} />
              ) : (
                <Eye size={18} color={Colors.dark.textMuted} />
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
            <Text style={styles.forgotLink}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.signInButton, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signInButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* SKYC-136: the resend the error message talks about, as an
              actual control on the screen the message points at. Only
              appears once an unconfirmed-email attempt has happened, so
              it never advertises a step nobody needs. */}
          {unconfirmedEmail ? (
            <View style={styles.resendBlock}>
              <Text style={styles.resendHint}>
                {unconfirmedEmail} still needs to be confirmed.
              </Text>
              <TouchableOpacity
                style={[styles.resendButton, resending && styles.buttonDisabled]}
                onPress={() => {
                  void resendConfirmation(unconfirmedEmail);
                }}
                disabled={resending}
                accessibilityRole="button"
                accessibilityLabel="Resend confirmation email"
              >
                {resending ? (
                  <ActivityIndicator color={Colors.dark.accent} />
                ) : (
                  <Text style={styles.resendButtonText}>
                    Resend confirmation email
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/sign-up')}>
            <Text style={styles.footerLink}>Sign Up</Text>
          </TouchableOpacity>
        </View>
    </KeyboardAwareScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 36,
    fontWeight: '900',
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  wave: {
    fontSize: 40,
    marginTop: 4,
  },
  tagline: {
    fontSize: 15,
    color: Colors.dark.textSecondary,
    marginTop: 8,
  },
  form: {
    gap: 14,
  },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.dark.text,
  },
  forgotLink: {
    fontSize: 13,
    color: Colors.dark.accent,
    textAlign: 'right',
  },
  signInButton: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  resendBlock: {
    gap: 8,
    marginTop: 4,
  },
  resendHint: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  resendButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  resendButtonText: {
    color: Colors.dark.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.dark.border,
  },
  dividerText: {
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
  googleButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  googleButtonText: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  footerLink: {
    fontSize: 14,
    color: Colors.dark.accent,
    fontWeight: '700',
  },
});
