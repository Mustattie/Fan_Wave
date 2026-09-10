import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Mail, Lock, User, Eye, EyeOff, ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { parseAuthError } from '@/lib/authErrors';
import { KeyboardAwareScreen } from '@/components/KeyboardAwareScreen';

export default function SignUpScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // v9.5.7 (iOS UAT BUG-8): validation used to speak ONLY through
  // Alert.alert. The tester tapped Create Account three times in 60
  // seconds and got nothing -- no spinner, no alert, no navigation --
  // while iOS AutoFill's strong-password overlay was presented over both
  // password fields.
  //
  // That is the explanation: presenting a UIAlertController while the
  // AutoFill overlay owns the presentation context silently fails on iOS.
  // Every early return in this handler raises an Alert, so a suppressed
  // Alert looks exactly like a dead button. The handler almost certainly
  // ran and told the user nothing.
  //
  // Two changes make a silent tap impossible: dismiss the keyboard (and
  // with it the AutoFill overlay) before validating, and render the error
  // inline on the screen as well as in the Alert. Inline text cannot be
  // swallowed by a presentation conflict.
  const [formError, setFormError] = useState<string | null>(null);

  const fail = (title: string, message: string) => {
    setFormError(message);
    Alert.alert(title, message);
  };

  const handleSignUp = async () => {
    // Releases the AutoFill overlay so an Alert has a clear context.
    Keyboard.dismiss();
    setFormError(null);

    if (!displayName.trim() || !email.trim() || !password.trim()) {
      fail('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (!confirmPassword.trim()) {
      // Called out separately because AutoFill can fill the first field
      // and leave this one empty, which previously fell into the generic
      // "Passwords do not match".
      fail('Confirm your password', 'Please re-enter your password in the Confirm Password field.');
      return;
    }
    if (password !== confirmPassword) {
      fail('Password mismatch', 'Passwords do not match.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      fail('Invalid email', 'Please enter a valid email address.');
      return;
    }
    // v9.2.5 UAT 2026-07-28: prior validator only checked length, but the
    // production Supabase project enforces character-class requirements
    // (lowercase + uppercase + digit) server-side. Users were passing
    // client-side then bouncing off Supabase's weak_password rejection
    // with a message that didn't actually explain the rule. Mirror the
    // server rule here so feedback is immediate and specific.
    if (password.length < 8) {
      fail('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      fail(
        'Weak password',
        'Password needs a mix of lowercase letters, uppercase letters, and a number.',
      );
      return;
    }

    setLoading(true);

    const trimmedEmail = email.trim();

    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: 'fansphere://auth-callback',
          data: {
            display_name: displayName.trim(),
          },
        },
      });

      if (error) throw error;

      // v8.7+ P0: Supabase's signUp endpoint returns a fake-success response
      // for already-confirmed emails (anti-enumeration). The tell is an empty
      // `identities` array on the returned user. Without this check the user
      // gets routed to a "Check your email" screen for an email that was
      // never actually sent — the exact dead-end users reported when trying
      // to sign up with their existing address.
      //
      // We surface this client-side. The server still returns the same fake
      // response so attackers can't enumerate; the legitimate user (who knows
      // their own email already exists) gets routed to sign-in.
      const identities = data?.user?.identities;
      if (Array.isArray(identities) && identities.length === 0) {
        await supabase.auth.signOut();
        Alert.alert(
          'Account already exists',
          `An account with ${trimmedEmail} is already registered. Sign in instead, or use "Forgot password" if you don't remember it.`,
          [
            { text: 'Sign In', onPress: () => router.replace('/(auth)/sign-in') },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }

      // Confirm Email is enabled in Supabase. signUp may return a temporary
      // session before the user verifies — sign it out so the user can't slip
      // through unverified, then route to the verify-email screen.
      await supabase.auth.signOut();

      Alert.alert(
        'Verify your email',
        `We've sent a confirmation link to ${trimmedEmail}. Tap it to activate your account.`,
        [
          {
            text: 'OK',
            onPress: () =>
              router.replace({
                pathname: '/(auth)/verify-email' as any,
                params: { email: trimmedEmail },
              }),
          },
        ]
      );
    } catch (e) {
      const info = parseAuthError(e);
      if (info.kind === 'email_already_registered') {
        Alert.alert(info.title, info.message, [
          { text: 'Sign In', onPress: () => router.replace('/(auth)/sign-in') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } else {
        Alert.alert(info.title, info.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={styles.content}
    >
        <TouchableOpacity
          onPress={() => router.replace('/(auth)/welcome')}
          style={styles.backBtn}
        >
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>

        <View style={styles.headerSection}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Join the wave. Find your crew anywhere.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <User size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Display Name"
              placeholderTextColor={Colors.dark.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Mail size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Colors.dark.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
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
              // BUG-8: both password fields had no content type, so iOS
              // AutoFill guessed. Declaring newPassword on both is what
              // makes it fill the pair together instead of painting the
              // strong-password overlay on one and leaving Confirm empty.
              textContentType="newPassword"
              autoComplete="new-password"
              // Generate a suggestion that already satisfies the server's
              // rule (mirrored in handleSignUp), so an accepted AutoFill
              // password can never bounce off our own validator.
              passwordRules="minlength: 8; required: lower; required: upper; required: digit;"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              {showPassword ? (
                <EyeOff size={18} color={Colors.dark.textMuted} />
              ) : (
                <Eye size={18} color={Colors.dark.textMuted} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Lock size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor={Colors.dark.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              textContentType="newPassword"
              autoComplete="new-password"
              passwordRules="minlength: 8; required: lower; required: upper; required: digit;"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleSignUp}
            />
          </View>

          {/* BUG-8: the visible, un-suppressable half of the feedback. */}
          {formError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.signUpButton, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signUpButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.consentText}>
            By creating an account, you agree to our{' '}
            <Text style={styles.consentLink} onPress={() => router.push('/legal/terms' as any)}>
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text style={styles.consentLink} onPress={() => router.push('/legal/privacy' as any)}>
              Privacy Policy
            </Text>
            .
          </Text>

        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')}>
            <Text style={styles.footerLink}>Sign In</Text>
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
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    justifyContent: 'center',
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 4,
    marginBottom: 16,
  },
  headerSection: {
    marginBottom: 32,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.dark.textSecondary,
    marginTop: 6,
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
  errorBox: {
    backgroundColor: 'rgba(255, 82, 82, 0.12)',
    borderWidth: 1,
    borderColor: Colors.dark.error,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: {
    color: Colors.dark.error,
    fontSize: 13,
    lineHeight: 18,
  },
  signUpButton: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 16,
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
    marginBottom: 24,
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
  consentText: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },
  consentLink: {
    color: Colors.dark.accent,
    fontWeight: '600',
  },
});
