import React, { useState } from 'react';
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
import { WCPassPaywall } from '@/components/paywall/WCPassPaywall';

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
  const [showWCPaywall, setShowWCPaywall] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const status = state?.status ?? 'none';
  const premiumUntil = state?.premiumActiveUntil ?? null;
  const wcUntil = state?.wcPassActiveUntil ?? null;
  const hasPremium = state?.hasPremiumAccess ?? false;
  const hasWC = state?.hasWCAccess ?? false;

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
            <Text style={styles.cardTitle}>Fan Sphere Premium</Text>
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
              onPress={() => setShowPremiumPaywall(true)}
            >
              <Text style={styles.primaryBtnText}>
                {status === 'cancelled' || status === 'expired' ? 'Resubscribe' : 'Start Free Trial'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* WC Pass status block */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            {hasWC ? (
              <CheckCircle size={20} color={Colors.dark.accentGreen} />
            ) : (
              <AlertCircle size={20} color={Colors.dark.textMuted} />
            )}
            <Text style={styles.cardTitle}>Soccer Cup 2026 Pass</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <Text style={styles.rowValue}>
              {hasWC ? 'Active' : status === 'trial' ? 'Included with trial' : 'Not purchased'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Valid through</Text>
            <Text style={styles.rowValue}>
              {wcUntil ? formatDate(wcUntil) : status === 'trial' ? `Trial ends ${formatDate(premiumUntil)}` : '—'}
            </Text>
          </View>

          {!hasWC && status !== 'trial' && (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: Colors.dark.accentGreen }]}
              onPress={() => setShowWCPaywall(true)}
            >
              <Text style={styles.primaryBtnText}>Buy Soccer Cup Pass — $19.99</Text>
            </TouchableOpacity>
          )}
        </View>

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

      <PremiumPaywall visible={showPremiumPaywall} onClose={() => setShowPremiumPaywall(false)} />
      <WCPassPaywall visible={showWCPaywall} onClose={() => setShowWCPaywall(false)} />
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
});
