import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users, Tent, UsersRound, Video, Ticket, Flag, ChevronRight,
  MapPin, Activity,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { FilterPillRow } from '@/components/FilterPillRow';
import { AdminKpiCard } from '@/components/AdminKpiCard';
import { AdminBarChart } from '@/components/AdminBarChart';
import { useAdminKpis, useSignupsByDay } from '@/hooks/useAdminData';

const TIME_OPTIONS = ['Today', '7 Days', '30 Days', 'All Time'];
const DAYS_MAP: Record<string, number> = { 'Today': 1, '7 Days': 7, '30 Days': 30, 'All Time': 0 };

export default function AdminOverview() {
  const router = useRouter();
  const [range, setRange] = useState('7 Days');
  const days = DAYS_MAP[range];

  const { data: kpis, isLoading: kLoading } = useAdminKpis(days);
  const { data: signups } = useSignupsByDay(days === 0 ? 30 : days);

  const chartData = (signups ?? []).map((s) => ({
    value: Number(s.signup_count),
    label: s.signup_date.slice(5), // MM-DD
  }));

  const navCards = [
    { icon: Tent,       label: 'Live Parties', route: '/(admin)/parties'    },
    { icon: UsersRound, label: 'Fan Groups',   route: '/(admin)/groups'     },
    { icon: Users,      label: 'Users',        route: '/(admin)/users'      },
    { icon: MapPin,     label: 'Geography',    route: '/(admin)/geography'  },
    { icon: Activity,   label: 'Activity',     route: '/(admin)/activity'   },
    { icon: Flag,       label: 'Moderation',   route: '/(admin)/moderation' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <FilterPillRow items={TIME_OPTIONS} activeItem={range} onSelect={setRange} />

        {kLoading ? (
          <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
        ) : (
          <>
            <View style={styles.grid}>
              <View style={styles.row}>
                <AdminKpiCard
                  icon={<Users size={20} color={Colors.dark.accent} />}
                  label="Total Users"
                  value={kpis?.total_users ?? 0}
                  delta={kpis?.new_users}
                  deltaLabel="new"
                />
                <View style={styles.gap} />
                <AdminKpiCard
                  icon={<Tent size={20} color="#ff8c00" />}
                  label="Watch Parties"
                  value={kpis?.total_parties ?? 0}
                  delta={kpis?.new_parties}
                  deltaLabel="new"
                />
              </View>
              <View style={styles.row}>
                <AdminKpiCard
                  icon={<UsersRound size={20} color={Colors.dark.accentLight} />}
                  label="Fan Groups"
                  value={kpis?.total_groups ?? 0}
                  delta={kpis?.new_groups}
                  deltaLabel="new"
                />
                <View style={styles.gap} />
                <AdminKpiCard
                  icon={<Video size={20} color={Colors.dark.success} />}
                  label="Clips"
                  value={kpis?.total_clips ?? 0}
                  delta={kpis?.new_clips}
                  deltaLabel="new"
                />
              </View>
              <View style={styles.row}>
                <AdminKpiCard
                  icon={<Ticket size={20} color={Colors.dark.warning} />}
                  label="RSVPs"
                  value={kpis?.total_rsvps ?? 0}
                  delta={kpis?.new_rsvps}
                  deltaLabel="new"
                />
                <View style={styles.gap} />
                <AdminKpiCard
                  icon={<Flag size={20} color={Colors.dark.error} />}
                  label="Flagged"
                  value={kpis?.flagged_content ?? 0}
                  onPress={() => router.push('/(admin)/moderation' as any)}
                />
              </View>
            </View>

            {chartData.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Signups Over Time</Text>
                <View style={styles.chartCard}>
                  <AdminBarChart data={chartData} height={120} showValues />
                </View>
              </View>
            )}
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sections</Text>
          {navCards.map(({ icon: Icon, label, route }) => (
            <TouchableOpacity
              key={label}
              style={styles.navCard}
              onPress={() => router.push(route as any)}
            >
              <Icon size={20} color={Colors.dark.accent} />
              <Text style={styles.navLabel}>{label}</Text>
              <ChevronRight size={18} color={Colors.dark.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.spacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loader: { marginTop: 40 },
  grid: { paddingHorizontal: 16, gap: 10 },
  row: { flexDirection: 'row' },
  gap: { width: 10 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 12,
  },
  chartCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    gap: 12,
  },
  navLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.dark.text },
  spacer: { height: 40 },
});
