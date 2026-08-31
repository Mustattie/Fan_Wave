import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { useSubscriptionState, restorePurchases } from '@/lib/entitlements';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';
import { getTierPrice } from '@/lib/entitlements';

// Apple/Google policy: cancellation must happen via the App Store /
// Play Store account settings, NOT inside the app. We deep-link.
const MANAGE_SUBSCRIPTION_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const { data: state } = useSubscriptionState();
  const [showPremiumPaywall, setShowPremiumPaywall] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // v9.5: which tier the sheet opens on. Until now this screen hardcoded
  // tier="home_team", so MVP was reachable from exactly one place in the
  // whole app — the analytics upsell — and a user browsing Subscription
  // could never discover the tier we charge $14.99 for.
  const [paywallTier, setPaywallTier] = useState<'home_team' | 'mvp'>('home_team');
  // Prices come from the store, never from a constant. Hardcoding them is
  // the v9.4.5 defect: the sheet advertised $34.99 while the store charged
  // $107.88. `null` renders as "—" and the card still opens the sheet,
  // which fails closed on its own billing disclosure.
  const [planPrices, setPlanPrices] = useState<Record<string, string | null>>({
    home_team: null,
    mvp: null,
  });

  const status = state?.status ?? 'none';
  const tier = state?.tier ?? 'free';
  const premiumUntil = state?.premiumActiveUntil ?? null;
  const hasPremium = state?.hasPremiumAccess ?? false;
  const TIER_TITLE: Record<string, string> = {
    free: 'Fan Sphere',
    home_team: 'Fan Sphere Home Team',
    mvp: 'Fan Sphere MVP',
    business: 'Fan Sphere Venue',
  };
  const cardTitle = TIER_TITLE[tier] ?? 'Fan Sphere';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ht, mvp] = await Promise.all([
        getTierPrice('home_team', 'monthly'),
        getTierPrice('mvp', 'monthly'),
      ]);
      if (cancelled) return;
      setPlanPrices({
        home_team: ht.available ? ht.priceString ?? null : null,
        mvp: mvp.available ? mvp.priceString ?? null : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openPaywall = (t: 'home_team' | 'mvp') => {
    setPaywallTier(t);
    setShowPremiumPaywall(true);
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    Alert.alert(
      ok ? 'Restore Complete' : 'Nothing to Restore',
      ok
        ? 'Your purchases have been restored. Entitlements update within a few seconds.'
        : 'No active purchases found for this account.',
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Premium status block */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            {hasPremium ? (
              <CheckCircle size={20} color={Colors.dark.accent} />
            ) : (
              <AlertCircle size={20} color={Colors.dark.textMuted} />
            )}
            <Text style={styles.cardTitle}>{cardTitle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <Text style={styles.rowValue}>
              {status === 'trial' && 'Trial'}
              {status === 'active' && 'Active'}
              {status === 'cancelled' && 'Cancelled'}
              {status === 'expired' && 'Expired'}
              {status === 'none' && 'None'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>
              {status === 'trial' ? 'Trial ends' : 'Renews / ends'}
            </Text>
            <Text style={styles.rowValue}>{formatDate(premiumUntil)}</Text>
          </View>

          {(!hasPremium || status === 'expired' || status === 'cancelled') && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => openPaywall('home_team')}
            >
              <Text style={styles.primaryBtnText}>
                {status === 'cancelled' || status === 'expired' ? 'Resubscribe' : 'Start Free Trial'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* v9.5: both tiers live here now. Shown by what the user does NOT
            already have — a free user sees both, a Home Team subscriber sees
            only the MVP upgrade, an MVP subscriber sees neither because there
            is nothing left to sell them. */}
        {tier !== 'mvp' && tier !== 'business' && (
          <View style={styles.plans}>
            <Text style={styles.plansHeading}>Plans</Text>

            {tier === 'free' && (
              <TouchableOpacity style={styles.planCard} onPress={() => openPaywall('home_team')}>
                <View style={styles.planTop}>
                  <Text style={styles.planName}>Home Team</Text>
                  <Text style={styles.planPrice}>{planPrices.home_team ?? '—'}</Text>
                </View>
                <Text style={styles.planBlurb}>
                  Unlimited clips, private invite-only watch parties, the full guest
                  list, and a badge fans can see.
                </Text>
                <Text style={styles.planCta}>See Home Team ›</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.planCard} onPress={() => openPaywall('mvp')}>
              <View style={styles.planTop}>
                <Text style={styles.planName}>MVP</Text>
                <Text style={styles.planPrice}>{planPrices.mvp ?? '—'}</Text>
              </View>
              <Text style={styles.planBlurb}>
                {tier === 'home_team'
                  ? 'Everything you have, plus audience analytics, a verified badge, and featured placement in Discover.'
                  : 'Everything in Home Team, plus audience analytics, a verified creator badge, and featured placement in Discover.'}
              </Text>
              <Text style={styles.planCta}>See MVP ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* v9.1: Soccer Cup 2026 Pass tile removed per WC sunset. Existing
            WC Pass buyers were grandfathered to +90d Premium via mig 065;
            the entitlement remains in the DB but is no longer purchasable
            or surfaced in-app. */}

        {/* Manage / Restore actions */}
        <View style={styles.actionList}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => Linking.openURL(MANAGE_SUBSCRIPTION_URL).catch(() => {})}
          >
            <View style={styles.actionRowLeft}>
              <ExternalLink size={18} color={Colors.dark.text} />
              <Text style={styles.actionRowText}>Manage in {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}</Text>
            </View>
            <Text style={styles.actionRowHint}>{'›'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={handleRestore} disabled={restoring}>
            <View style={styles.actionRowLeft}>
              <RefreshCw size={18} color={Colors.dark.text} />
              <Text style={styles.actionRowText}>{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.legalCopy}>
          Subscriptions auto-renew unless cancelled at least 24 hours before the period ends.
          To cancel, use the "Manage" link above — Apple and Google policy requires cancellation
          to happen through your account settings, not inside the app.
        </Text>
      </ScrollView>

      <PremiumPaywall
        tier={paywallTier}
        visible={showPremiumPaywall}
        onClose={() => setShowPremiumPaywall(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  scroll: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, color: Colors.dark.textSecondary },
  rowValue: { fontSize: 13, color: Colors.dark.text, fontWeight: '600' },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: Colors.dark.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  actionList: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  actionRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionRowText: { fontSize: 14, color: Colors.dark.text },
  actionRowHint: { fontSize: 18, color: Colors.dark.textMuted },
  legalCopy: { fontSize: 11, lineHeight: 16, color: Colors.dark.textMuted, paddingHorizontal: 4 },

  plans: { marginTop: 4, marginBottom: 16, gap: 10 },
  plansHeading: {
    fontSize: 13, fontWeight: '700', color: Colors.dark.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2, paddingHorizontal: 4,
  },
  planCard: {
    backgroundColor: Colors.dark.surface, borderRadius: 14, padding: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.dark.border, gap: 6,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  planPrice: { fontSize: 15, fontWeight: '700', color: Colors.dark.accent },
  planBlurb: { fontSize: 13, lineHeight: 18, color: Colors.dark.textSecondary },
  planCta: { fontSize: 13, fontWeight: '700', color: Colors.dark.accent, marginTop: 2 },
});
