import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Tent, Users, Flag } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { AdminKpiCard } from '@/components/AdminKpiCard';
import { AdminBarChart } from '@/components/AdminBarChart';
import { useAdminKpis, usePartiesByCity, useSignupsByDay } from '@/hooks/useAdminData';

export default function AdminParties() {
  const { data: kpis, isLoading } = useAdminKpis(30);
  const { data: cities } = usePartiesByCity(10);
  const { data: signups } = useSignupsByDay(30);

  const chartData = (signups ?? []).map((s) => ({
    value: Number(s.signup_count),
    label: s.signup_date.slice(5),
  }));

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
        ) : (
          <>
            <View style={styles.kpiRow}>
              <AdminKpiCard
                icon={<Tent size={20} color={Colors.dark.accent} />}
                label="Total Parties"
                value={kpis?.total_parties ?? 0}
                delta={kpis?.new_parties}
                deltaLabel="(30d)"
              />
              <View style={styles.gap} />
              <AdminKpiCard
                icon={<Users size={20} color={Colors.dark.success} />}
                label="Total RSVPs"
                value={kpis?.total_rsvps ?? 0}
              />
              <View style={styles.gap} />
              <AdminKpiCard
                icon={<Flag size={20} color={Colors.dark.error} />}
                label="Flagged"
                value={kpis?.flagged_content ?? 0}
              />
            </View>

            {chartData.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Activity (Last 30 Days)</Text>
                <View style={styles.card}>
                  <AdminBarChart data={chartData} color="#ff8c00" height={120} />
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Cities by Parties</Text>
              {(cities ?? []).map((c, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={styles.rank}>{idx + 1}</Text>
                  <Text style={styles.city}>{c.city}</Text>
                  <View style={styles.cityStats}>
                    <Text style={styles.statVal}>{c.party_count} parties</Text>
                    <Text style={styles.statSub}>{c.rsvp_count} RSVPs</Text>
                  </View>
                </View>
              ))}
              {(cities ?? []).length === 0 && (
                <Text style={styles.empty}>No party data yet.</Text>
              )}
            </View>
          </>
        )}
        <View style={styles.spacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loader: { marginTop: 40 },
  kpiRow: { flexDirection: 'row', padding: 16 },
  gap: { width: 8 },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 12 },
  card: {
    backgroundColor: Colors.dark.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 14, marginBottom: 6, gap: 12,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  rank: { fontSize: 13, color: Colors.dark.textMuted, width: 20, textAlign: 'center' },
  city: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  cityStats: { alignItems: 'flex-end' },
  statVal: { fontSize: 13, fontWeight: '700', color: Colors.dark.accent },
  statSub: { fontSize: 11, color: Colors.dark.textSecondary },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 20 },
  spacer: { height: 40 },
});
