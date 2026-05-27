import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { useSubscriptionState, restorePurchases } from '@/lib/entitlements';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';
import { supabase } from '@/lib/supabase';

const MANAGE_SUBSCRIPTION_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

// Landing screen for users with status='cancelled' or 'expired'.
// NavigationGuard (FW-95) routes them here on every app open. The only
// way out is to resubscribe (entitlement Realtime flips them back to
// the main app) or sign out.
export default function ResubscribeScreen() {
  const router = useRouter();
  const { data: state } = useSubscriptionState();
  const [showPaywall, setShowPaywall] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const status = state?.status ?? 'expired';
  const premiumUntil = state?.premiumActiveUntil ?? null;
  const expiredDate =
    premiumUntil && premiumUntil.getTime() < Date.now()
      ? premiumUntil.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : null;

  const handleRestore = async () => {
    setRestoring(true);
    await restorePurchases();
    setRestoring(false);
    // If restore succeeds, the webhook → Realtime flow flips the user's
    // status and NavigationGuard will route them away from here.
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/sign-in');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroSection}>
          <Text style={styles.eyebrow}>Welcome back</Text>
          <Text style={styles.title}>Your Fan Sphere subscription has ended</Text>
          {expiredDate && (
            <Text style={styles.subtitle}>
              {status === 'cancelled' ? 'Cancelled' : 'Expired'} on {expiredDate}
            </Text>
          )}
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureCardTitle}>Resubscribe to get back to:</Text>
          <View style={styles.featureList}>
            <Text style={styles.featureLine}>• Post clips + moments</Text>
            <Text style={styles.featureLine}>• Create + RSVP to watch parties</Text>
            <Text style={styles.featureLine}>• Join + create fan groups</Text>
            <Text style={styles.featureLine}>• Follow your teams</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Resubscribe — $9.99/mo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => Linking.openURL(MANAGE_SUBSCRIPTION_URL).catch(() => {})}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryBtnText}>
            Manage in {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tertiaryBtn}
          onPress={handleRestore}
          disabled={restoring}
          activeOpacity={0.7}
        >
          <RefreshCw size={14} color={Colors.dark.textSecondary} />
          <Text style={styles.tertiaryBtnText}>
            {restoring ? 'Restoring…' : 'Restore Purchases'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <PremiumPaywall visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { padding: 24, paddingTop: 32, paddingBottom: 16 },
  heroSection: { marginBottom: 28 },
  eyebrow: { fontSize: 13, color: Colors.dark.accent, fontWeight: '700', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.dark.text, marginBottom: 8, lineHeight: 32 },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary },
  featureCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 24,
  },
  featureCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.dark.text, marginBottom: 10 },
  featureList: { gap: 8 },
  featureLine: { fontSize: 14, color: Colors.dark.textSecondary },
  primaryBtn: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  secondaryBtn: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  tertiaryBtn: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tertiaryBtnText: { fontSize: 13, color: Colors.dark.textSecondary },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  signOutText: { fontSize: 13, color: Colors.dark.textMuted, textDecorationLine: 'underline' },
});
