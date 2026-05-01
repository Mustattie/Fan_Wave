import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Users, MapPin, CheckCircle } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { AdminKpiCard } from '@/components/AdminKpiCard';
import { AdminBarChart } from '@/components/AdminBarChart';
import { useAdminKpis, useSignupsByDay } from '@/hooks/useAdminData';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useIsAdmin } from '@/hooks/useAdminData';

function useRecentUsers() {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'recentUsers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, display_name, home_city, home_country, onboarded_at, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
    enabled: !!isAdmin,
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminUsers() {
  const router = useRouter();
  const { data: kpis, isLoading } = useAdminKpis(30);
  const { data: signups } = useSignupsByDay(30);
  const { data: recentUsers } = useRecentUsers();

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
                icon={<Users size={20} color={Colors.dark.accent} />}
                label="Total Users"
                value={kpis?.total_users ?? 0}
                delta={kpis?.new_users}
                deltaLabel="(30d)"
              />
              <View style={styles.gap} />
              <AdminKpiCard
                icon={<CheckCircle size={20} color={Colors.dark.success} />}
                label="New Signups"
                value={kpis?.new_users ?? 0}
              />
            </View>

            {chartData.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Signups — Last 30 Days</Text>
                <View style={styles.card}>
                  <AdminBarChart data={chartData} height={120} showValues />
                </View>
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Signups</Text>
                <TouchableOpacity onPress={() => router.push('/(admin)/geography' as any)}>
                  <View style={styles.geoBtn}>
                    <MapPin size={14} color={Colors.dark.accent} />
                    <Text style={styles.geoBtnText}>View Geography</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {(recentUsers ?? []).map((u: any) => (
                <View key={u.id} style={styles.userRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(u.display_name ?? '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{u.display_name ?? 'Unknown'}</Text>
                    <Text style={styles.userSub}>
                      {[u.home_city, u.home_country].filter(Boolean).join(', ') || 'No location'}
                    </Text>
                  </View>
                  <View style={styles.userRight}>
                    <Text style={styles.timeAgo}>{timeAgo(u.created_at)}</Text>
                    {u.onboarded_at
                      ? <Text style={styles.badge}>Onboarded</Text>
                      : <Text style={[styles.badge, styles.badgePending]}>Pending</Text>
                    }
                  </View>
                </View>
              ))}
              {(recentUsers ?? []).length === 0 && (
                <Text style={styles.empty}>No users yet.</Text>
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  geoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: Colors.dark.surface,
    borderWidth: 1, borderColor: Colors.dark.accent,
  },
  geoBtnText: { fontSize: 12, color: Colors.dark.accent, fontWeight: '600' },
  card: {
    backgroundColor: Colors.dark.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  userRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 12, marginBottom: 6, gap: 12,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  userSub: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
  userRight: { alignItems: 'flex-end', gap: 4 },
  timeAgo: { fontSize: 11, color: Colors.dark.textMuted },
  badge: {
    fontSize: 10, fontWeight: '700', color: Colors.dark.success,
    backgroundColor: Colors.dark.accentGreenDark,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  badgePending: {
    color: Colors.dark.warning,
    backgroundColor: 'rgba(255,193,7,0.15)',
  },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 20 },
  spacer: { height: 40 },
});
