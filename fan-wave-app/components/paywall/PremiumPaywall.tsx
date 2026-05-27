import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { purchasePremium, restorePurchases } from '@/lib/entitlements';
import { reportError } from '@/lib/errorReporting';

type Plan = 'monthly' | 'annual';
type State = 'idle' | 'purchasing' | 'success';

const FEATURES = [
  'Post clips and moments',
  'Create + RSVP to watch parties',
  'Join and create fan groups',
  'Follow your favorite teams',
  'Ad-free experience',
];

const PRICES = {
  monthly: { display: '$9.99/mo', period: 'month' },
  annual: { display: '$107.88/yr', period: 'year', savingsBadge: 'Save 10%' },
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  // Default to monthly highlighted; the Choose Plan onboarding screen
  // can override based on which card the user tapped.
  initialPlan?: Plan;
}

export function PremiumPaywall({ visible, onClose, onSuccess, initialPlan = 'monthly' }: Props) {
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [state, setState] = useState<State>('idle');

  const handlePurchase = async () => {
    setState('purchasing');
    const result = await purchasePremium(plan);
    if (result.kind === 'success') {
      setState('success');
      // Brief success flash, then dismiss + entitlement Realtime fires.
      setTimeout(() => {
        setState('idle');
        onSuccess?.();
        onClose();
      }, 1200);
    } else if (result.kind === 'pending') {
      // Dialog closed, receipt pending — webhook will catch up.
      setState('idle');
      onSuccess?.();
      onClose();
    } else if (result.kind === 'cancelled') {
      setState('idle');
    } else {
      reportError(result.error, { source: 'PremiumPaywall:purchase', plan });
      setState('idle');
    }
  };

  const handleRestore = async () => {
    setState('purchasing');
    try {
      const ok = await restorePurchases();
      if (ok) {
        setState('success');
        setTimeout(() => {
          setState('idle');
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        setState('idle');
      }
    } catch (e) {
      reportError(e, { source: 'PremiumPaywall:restore' });
      setState('idle');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Fan Sphere Premium</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={22} color={Colors.dark.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.subtitle}>7 days free, then your plan</Text>

            <View style={styles.planRow}>
              {(['monthly', 'annual'] as Plan[]).map((p) => {
                const active = plan === p;
                const price = PRICES[p];
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.planCard, active && styles.planCardActive]}
                    onPress={() => setPlan(p)}
                    activeOpacity={0.7}
                  >
                    {('savingsBadge' in price) && (price as any).savingsBadge && (
                      <View style={styles.savingsBadge}>
                        <Text style={styles.savingsText}>{(price as any).savingsBadge}</Text>
                      </View>
                    )}
                    <Text style={styles.planLabel}>{p === 'monthly' ? 'Monthly' : 'Annual'}</Text>
                    <Text style={[styles.planPrice, active && styles.planPriceActive]}>{price.display}</Text>
                    <Text style={styles.planPeriod}>per {price.period}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.featureList}>
              {FEATURES.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <Check size={16} color={Colors.dark.accent} />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.disclosureCopy}>
              Start your 7-day free trial. We'll charge {PRICES[plan].display} after the trial ends.
              Subscriptions auto-renew unless cancelled. Manage or cancel anytime in your{' '}
              App Store or Google Play account settings.
            </Text>

            <View style={styles.linkRow}>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://fansphere.app/terms').catch(() => {})}
              >
                <Text style={styles.linkText}>Terms</Text>
              </TouchableOpacity>
              <Text style={styles.linkDivider}>·</Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://fansphere.app/privacy').catch(() => {})}
              >
                <Text style={styles.linkText}>Privacy</Text>
              </TouchableOpacity>
              <Text style={styles.linkDivider}>·</Text>
              <TouchableOpacity onPress={handleRestore} disabled={state === 'purchasing'}>
                <Text style={styles.linkText}>Restore Purchases</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.ctaBtn, state !== 'idle' && styles.ctaBtnDisabled]}
            onPress={handlePurchase}
            disabled={state !== 'idle'}
            activeOpacity={0.8}
          >
            {state === 'purchasing' ? (
              <ActivityIndicator color="#fff" />
            ) : state === 'success' ? (
              <Text style={styles.ctaText}>✓ Welcome to Premium</Text>
            ) : (
              <Text style={styles.ctaText}>Start 7-Day Free Trial</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.dark.text },
  closeBtn: { padding: 4 },
  subtitle: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 16 },
  planRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  planCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: Colors.dark.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    position: 'relative',
  },
  planCardActive: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accent + '15' },
  savingsBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: Colors.dark.accentGreen,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  savingsText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  planLabel: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 6 },
  planPrice: { fontSize: 18, fontWeight: '800', color: Colors.dark.text },
  planPriceActive: { color: Colors.dark.accent },
  planPeriod: { fontSize: 11, color: Colors.dark.textMuted, marginTop: 2 },
  featureList: { gap: 10, marginBottom: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14, color: Colors.dark.text, flex: 1 },
  disclosureCopy: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.dark.textMuted,
    marginBottom: 12,
  },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 16 },
  linkText: { fontSize: 12, color: Colors.dark.textSecondary, textDecorationLine: 'underline' },
  linkDivider: { fontSize: 12, color: Colors.dark.textMuted },
  ctaBtn: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
