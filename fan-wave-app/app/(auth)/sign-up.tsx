import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
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

  const handleSignUp = async () => {
    if (!displayName.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Passwords do not match.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    const trimmedEmail = email.trim();

    try {
      const { error } = await supabase.auth.signUp({
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

          <View style={styles.inputGroup}>
            <Lock size={18} color={Colors.dark.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor={Colors.dark.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.signUpButton, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={loading}
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
