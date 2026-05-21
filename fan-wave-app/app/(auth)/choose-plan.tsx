import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';

type Plan = 'monthly' | 'annual';

const PERKS = [
  'Post unlimited clips + moments',
  'Create + RSVP to watch parties',
  'Join + create fan groups',
  'Follow your teams + live score push',
  'Ad-free',
];

export default function ChoosePlanScreen() {
  const router = useRouter();
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  const handleSelectPlan = (plan: Plan) => setPendingPlan(plan);

  const handlePurchaseSuccess = () => {
    // Webhook + realtime will flip subscription_status to 'trial'.
    // NavigationGuard will pick that up; we just navigate to the
    // optional WC Pass offer.
    router.replace('/(auth)/wc-pass-offer');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <Text style={styles.eyebrow}>Welcome to Fan Wave</Text>
          <Text style={styles.title}>Start your 7-day free trial</Text>
          <Text style={styles.subtitle}>
            Try everything for a week. Cancel any time in your App Store / Google Play settings.
          </Text>
        </View>

        <View style={styles.perksList}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perkRow}>
              <Check size={18} color={Colors.dark.accent} />
              <Text style={styles.perkText}>{p}</Text>
            </View>
          ))}
        </View>

        <View style={styles.planSection}>
          <TouchableOpacity
            style={styles.planCard}
            onPress={() => handleSelectPlan('annual')}
            activeOpacity={0.7}
          >
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsBadgeText}>SAVE 10%</Text>
            </View>
            <Text style={styles.planLabel}>Annual</Text>
            <Text style={styles.planPrice}>$107.88<Text style={styles.planPricePeriod}> / year</Text></Text>
            <Text style={styles.planEffective}>$8.99/month equivalent</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.planCard}
            onPress={() => handleSelectPlan('monthly')}
            activeOpacity={0.7}
          >
            <Text style={styles.planLabel}>Monthly</Text>
            <Text style={styles.planPrice}>$9.99<Text style={styles.planPricePeriod}> / month</Text></Text>
            <Text style={styles.planEffective}>billed monthly after trial</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.legalCopy}>
          Tap a plan to start your 7-day free trial. We'll charge the listed amount after the trial ends.
          Subscriptions auto-renew unless cancelled at least 24h before the period ends. Manage anywhere
          in your App Store / Google Play account settings.
        </Text>
      </ScrollView>

      <PremiumPaywall
        visible={pendingPlan !== null}
        initialPlan={pendingPlan ?? 'monthly'}
        onClose={() => setPendingPlan(null)}
        onSuccess={handlePurchaseSuccess}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { padding: 24, paddingBottom: 40 },
  heroSection: { marginTop: 12, marginBottom: 24 },
  eyebrow: { fontSize: 13, color: Colors.dark.accent, fontWeight: '700', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.dark.text, marginBottom: 8, lineHeight: 34 },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 20 },
  perksList: { gap: 12, marginBottom: 28 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkText: { fontSize: 15, color: Colors.dark.text, flex: 1 },
  planSection: { gap: 14, marginBottom: 20 },
  planCard: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 2,
    borderColor: Colors.dark.accent,
    borderRadius: 16,
    padding: 18,
    position: 'relative',
  },
  savingsBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: Colors.dark.accentGreen,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  savingsBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  planLabel: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 6 },
  planPrice: { fontSize: 28, fontWeight: '800', color: Colors.dark.text },
  planPricePeriod: { fontSize: 14, fontWeight: '600', color: Colors.dark.textSecondary },
  planEffective: { fontSize: 12, color: Colors.dark.textMuted, marginTop: 4 },
  legalCopy: { fontSize: 11, lineHeight: 16, color: Colors.dark.textMuted, textAlign: 'center' },
});
