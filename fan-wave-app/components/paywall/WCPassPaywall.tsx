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
  Alert,
  Platform,
} from 'react-native';

// See note in PremiumPaywall.tsx — Apple Review 2.3.10 rejection.
const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X, Star } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { purchaseWCPass, restorePurchases } from '@/lib/entitlements';
import { reportError } from '@/lib/errorReporting';

type State = 'idle' | 'purchasing' | 'success';

const FEATURES = [
  'Join Soccer Cup fan groups',
  'RSVP + host Soccer Cup watch parties',
  'Follow national teams',
  'Post moments + clips on tournament matches',
  'Valid June 1 – July 31, 2026',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function WCPassPaywall({ visible, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>('idle');

  const handlePurchase = async () => {
    setState('purchasing');
    const result = await purchaseWCPass();
    if (result.kind === 'success') {
      setState('success');
      setTimeout(() => {
        setState('idle');
        onSuccess?.();
        onClose();
      }, 1200);
    } else if (result.kind === 'pending') {
      setState('idle');
      onSuccess?.();
      onClose();
    } else if (result.kind === 'cancelled') {
      setState('idle');
    } else {
      reportError(result.error, { source: 'WCPassPaywall:purchase' });
      setState('idle');
      Alert.alert(
        'Purchase could not start',
        `We couldn't open the ${STORE_NAME} purchase sheet. Please try again, or contact support@thabtech.com if it keeps happening.`,
      );
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
      reportError(e, { source: 'WCPassPaywall:restore' });
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
            <View style={styles.titleRow}>
              <Star size={18} color={Colors.dark.accentGreen} fill={Colors.dark.accentGreen} />
              <Text style={styles.title}>Soccer Cup 2026 Pass</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={22} color={Colors.dark.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.priceRow}>
              <Text style={styles.priceMain}>$19.99</Text>
              <Text style={styles.priceMeta}>one-time · June 1 – July 31</Text>
            </View>

            <View style={styles.featureList}>
              {FEATURES.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <Check size={16} color={Colors.dark.accentGreen} />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.disclosureCopy}>
              One-time purchase of $19.99. Access is valid through July 31, 2026 (with a one-week buffer
              past the Final). Not auto-renewing. Refunds handled by your {STORE_NAME} account.
            </Text>

            <View style={styles.linkRow}>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://fansphere.org/terms').catch(() => {})}
              >
                <Text style={styles.linkText}>Terms</Text>
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
              <Text style={styles.ctaText}>✓ Pass unlocked</Text>
            ) : (
              <Text style={styles.ctaText}>Buy Soccer Cup Pass</Text>
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
    marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.dark.text },
  closeBtn: { padding: 4 },
  priceRow: { alignItems: 'center', marginBottom: 24, paddingVertical: 16, backgroundColor: Colors.dark.accentGreen + '15', borderRadius: 14 },
  priceMain: { fontSize: 36, fontWeight: '900', color: Colors.dark.accentGreen },
  priceMeta: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  featureList: { gap: 10, marginBottom: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14, color: Colors.dark.text, flex: 1 },
  disclosureCopy: { fontSize: 11, lineHeight: 16, color: Colors.dark.textMuted, marginBottom: 12 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 16 },
  linkText: { fontSize: 12, color: Colors.dark.textSecondary, textDecorationLine: 'underline' },
  linkDivider: { fontSize: 12, color: Colors.dark.textMuted },
  ctaBtn: {
    backgroundColor: Colors.dark.accentGreen,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
