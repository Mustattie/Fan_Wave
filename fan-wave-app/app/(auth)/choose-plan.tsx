import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';
import { getTierPrice } from '@/lib/entitlements';

type Plan = 'monthly' | 'annual';

// Apple Review 2.3.10 — never mention "Google Play" in iOS-rendered copy.
const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

// Home Team perks — mirrors PremiumPaywall's TIER_CONFIG.home_team.features
// so the pre-sheet preview matches what the purchase sheet displays.
const PERKS = [
  'Unlimited clip posting',
  'Unlimited fan groups',
  'Public + private watch parties',
  'Home Team badge on your profile',
  'Priority search visibility',
  'Ad-free experience',
];

export default function ChoosePlanScreen() {
  const router = useRouter();
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  // v9.4.5: these cards used to hardcode $34.99 / $4.99. They are the first
  // price a user ever sees, and they were stating a number the store would
  // not necessarily charge -- the same defect fixed in PremiumPaywall. Read
  // the live package price instead, and say nothing when there is no package.
  const [prices, setPrices] = useState<Record<Plan, string | null>>({
    monthly: null,
    annual: null,
  });
  const [pricesLoaded, setPricesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, a] = await Promise.all([
        getTierPrice('home_team', 'monthly'),
        getTierPrice('home_team', 'annual'),
      ]);
      if (cancelled) return;
      setPrices({
        monthly: m.available ? m.priceString : null,
        annual: a.available ? a.priceString : null,
      });
      setPricesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSelectPlan = (plan: Plan) => setPendingPlan(plan);

  const handlePurchaseSuccess = () => {
    // Webhook + realtime flip subscription_status to 'trial' and
    // subscription_tier to 'home_team'. Send the new subscriber into
    // the app.
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <Text style={styles.eyebrow}>Fan Sphere Home Team</Text>
          <Text style={styles.title}>Organize the crew.</Text>
          <Text style={styles.subtitle}>
            Try Home Team free for 7 days. Cancel any time in your {STORE_NAME} settings.
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
            {prices.annual && prices.monthly && (
              <View style={styles.savingsBadge}>
                <Text style={styles.savingsBadgeText}>SAVE 42%</Text>
              </View>
            )}
            <Text style={styles.planLabel}>Annual</Text>
            <Text style={styles.planPrice}>
              {!pricesLoaded ? '—' : (prices.annual ?? 'Unavailable')}
              {prices.annual ? <Text style={styles.planPricePeriod}> / year</Text> : null}
            </Text>
            <Text style={styles.planEffective}>
              {prices.annual ? 'billed yearly after trial' : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.planCard}
            onPress={() => handleSelectPlan('monthly')}
            activeOpacity={0.7}
          >
            <Text style={styles.planLabel}>Monthly</Text>
            <Text style={styles.planPrice}>
              {!pricesLoaded ? '—' : (prices.monthly ?? 'Unavailable')}
              {prices.monthly ? <Text style={styles.planPricePeriod}> / month</Text> : null}
            </Text>
            <Text style={styles.planEffective}>
              {prices.monthly ? 'billed monthly after trial' : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.legalCopy}>
          Tap a plan to start your 7-day free trial. We'll charge the listed amount after the trial ends.
          Subscriptions auto-renew unless cancelled at least 24h before the period ends. Manage anywhere
          in your {STORE_NAME} account settings.
        </Text>

        {/* v9.3 freemium: onboarding no longer forces this screen — it's
            reached only via Profile → Upgrade. Keep the escape hatch so
            the user can back out of the paywall flow without a hard
            router.back(). */}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => router.replace('/(tabs)')}
          activeOpacity={0.7}
        >
          <Text style={styles.skipBtnText}>Not now</Text>
        </TouchableOpacity>
      </ScrollView>

      <PremiumPaywall
        tier="home_team"
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
  skipBtn: {
    marginTop: 18,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    textDecorationLine: 'underline',
  },
});
