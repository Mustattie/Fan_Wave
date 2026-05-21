import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Star, Check } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { WCPassPaywall } from '@/components/paywall/WCPassPaywall';

const PERKS = [
  'Join World Cup fan groups',
  'RSVP + host WC watch parties',
  'Follow your national teams',
  'Post moments + clips on WC matches',
];

export default function WCPassOfferScreen() {
  const router = useRouter();
  const [showPaywall, setShowPaywall] = useState(false);

  const handleSkip = () => router.replace('/(tabs)');
  const handleSuccess = () => {
    // Realtime entitlement update will fire; navigate to tabs.
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.accentGreenDark, Colors.dark.accentGreen]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroBanner}
      >
        <Star size={48} color="#fff" fill="#fff" />
        <Text style={styles.heroTitle}>World Cup 2026</Text>
        <Text style={styles.heroSubtitle}>USA · Canada · Mexico · June 11 – July 19</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Get the World Cup Pass</Text>
        <Text style={styles.sectionBody}>
          Unlock the WC tab for the entire tournament. One-time purchase, no auto-renewal.
        </Text>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>One-time</Text>
          <Text style={styles.priceMain}>$19.99</Text>
          <Text style={styles.priceFinePrint}>Valid June 1 – July 31, 2026</Text>
        </View>

        <View style={styles.perksList}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perkRow}>
              <Check size={16} color={Colors.dark.accentGreen} />
              <Text style={styles.perkText}>{p}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.note}>
          You can buy this later from Settings → Subscription if you'd rather wait.
        </Text>
      </ScrollView>

      <View style={styles.ctaRow}>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip — Maybe Later</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.buyBtn}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.buyText}>Add WC Pass</Text>
        </TouchableOpacity>
      </View>

      <WCPassPaywall
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSuccess={handleSuccess}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  heroBanner: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 8,
  },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#fff' },
  heroSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  scroll: { padding: 24, paddingBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: Colors.dark.text, marginBottom: 8 },
  sectionBody: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 20, marginBottom: 20 },
  priceCard: {
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    paddingVertical: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.dark.accentGreen + '40',
  },
  priceLabel: { fontSize: 11, color: Colors.dark.textMuted, marginBottom: 4, letterSpacing: 1 },
  priceMain: { fontSize: 36, fontWeight: '900', color: Colors.dark.accentGreen },
  priceFinePrint: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 6 },
  perksList: { gap: 10, marginBottom: 16 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkText: { fontSize: 14, color: Colors.dark.text, flex: 1 },
  note: { fontSize: 12, color: Colors.dark.textMuted, textAlign: 'center', marginTop: 8 },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  skipBtn: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  skipText: { fontSize: 14, fontWeight: '600', color: Colors.dark.textSecondary },
  buyBtn: {
    flex: 1.4,
    backgroundColor: Colors.dark.accentGreen,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  buyText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
