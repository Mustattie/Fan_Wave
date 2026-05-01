import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UsersRound, Users } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { AdminKpiCard } from '@/components/AdminKpiCard';
import { AdminBarChart } from '@/components/AdminBarChart';
import { useAdminKpis, useGroupsBySport } from '@/hooks/useAdminData';

const SPORT_COLORS: Record<string, string> = {
  NFL: Colors.dark.nfl,
  NBA: '#ff8c00',
  Soccer: Colors.dark.soccer,
  MLB: Colors.dark.mlb,
  NHL: Colors.dark.nhl,
  General: Colors.dark.textMuted,
};

export default function AdminGroups() {
  const { data: kpis, isLoading } = useAdminKpis(30);
  const { data: sports } = useGroupsBySport();

  const chartData = (sports ?? []).map((s) => ({
    value: Number(s.group_count),
    label: s.sport_name.slice(0, 5),
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
                icon={<UsersRound size={20} color={Colors.dark.accent} />}
                label="Total Groups"
                value={kpis?.total_groups ?? 0}
                delta={kpis?.new_groups}
                deltaLabel="(30d)"
              />
              <View style={styles.gap} />
              <AdminKpiCard
                icon={<Users size={20} color={Colors.dark.success} />}
                label="New Groups"
                value={kpis?.new_groups ?? 0}
              />
            </View>

            {chartData.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Groups by Sport</Text>
                <View style={styles.card}>
                  <AdminBarChart data={chartData} height={120} showValues />
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sport Breakdown</Text>
              {(sports ?? []).map((s, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <View style={[styles.dot, { backgroundColor: SPORT_COLORS[s.sport_name] ?? Colors.dark.accent }]} />
                  <Text style={styles.sportName}>{s.sport_name}</Text>
                  <View style={styles.sportStats}>
                    <Text style={styles.statVal}>{s.group_count} groups</Text>
                    <Text style={styles.statSub}>{s.total_members} members</Text>
                  </View>
                </View>
              ))}
              {(sports ?? []).length === 0 && (
                <Text style={styles.empty}>No group data yet.</Text>
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
  dot: { width: 10, height: 10, borderRadius: 5 },
  sportName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  sportStats: { alignItems: 'flex-end' },
  statVal: { fontSize: 13, fontWeight: '700', color: Colors.dark.accent },
  statSub: { fontSize: 11, color: Colors.dark.textSecondary },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 20 },
  spacer: { height: 40 },
});
