import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Mail, ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { parseAuthError } from '@/lib/authErrors';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const [resending, setResending] = useState(false);

  const handleResend = async () => {
    if (!email) {
      Alert.alert(
        'Missing email',
        'We could not find the email address to resend to. Please sign up again.',
      );
      return;
    }

    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: 'fansphere://auth-callback',
        },
      });
      if (error) throw error;
      Alert.alert(
        'Email sent',
        `We sent a new confirmation link to ${email}.`,
      );
    } catch (e) {
      const info = parseAuthError(e);
      Alert.alert(info.title, info.message);
    } finally {
      setResending(false);
    }
  };

  const handleGoToSignIn = () => {
    router.replace('/(auth)/sign-in');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          onPress={() => router.replace('/(auth)/welcome')}
          style={styles.backBtn}
        >
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Mail size={36} color={Colors.dark.accent} />
          </View>
        </View>

        <View style={styles.headerSection}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We've sent a confirmation link to{' '}
            <Text style={styles.emailText}>{email || 'your email'}</Text>.
          </Text>
          <Text style={styles.body}>
            Tap the link in your email to activate your account. Once verified,
            come back here to sign in.
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleGoToSignIn}
          >
            <Text style={styles.primaryButtonText}>
              I've verified — sign me in
            </Text>
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>Didn't get it? </Text>
            <TouchableOpacity onPress={handleResend} disabled={resending}>
              {resending ? (
                <ActivityIndicator color={Colors.dark.accent} size="small" />
              ) : (
                <Text style={styles.resendLink}>Resend</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerHint}>
            Make sure to check your spam folder. The link expires after a short
            time — tap Resend if it stops working.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  iconWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSection: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.dark.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: Colors.dark.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 22,
  },
  emailText: {
    color: Colors.dark.text,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    color: Colors.dark.textMuted,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    gap: 18,
  },
  primaryButton: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resendText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  resendLink: {
    fontSize: 14,
    color: Colors.dark.accent,
    fontWeight: '700',
  },
  footer: {
    marginTop: 32,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  footerHint: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
