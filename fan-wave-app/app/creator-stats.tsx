import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Eye, Heart, Share2, Users } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

type TimePeriod = '7d' | '30d' | 'all';

interface StatCard {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

interface ClipStat {
  id: string;
  title: string;
  view_count: number;
  like_count: number;
  created_at: string;
}

export default function CreatorStatsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('30d');
  const [stats, setStats] = useState({ views: 0, likes: 0, shares: 0, followers: 0 });
  const [topClips, setTopClips] = useState<ClipStat[]>([]);

  useEffect(() => {
    loadStats();
  }, [period]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get follower count from users table
      const { data: profile } = await supabase
        .from('users')
        .select('follower_count')
        .eq('auth_id', user.id)
        .single();

      // Date filter
      const dateFilter = period === '7d'
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        : period === '30d'
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          : '1970-01-01T00:00:00Z';

      // Get clips with stats
      let query = supabase
        .from('media_clips')
        .select('id, title, view_count, like_count, created_at')
        .eq('user_id', user.id)
        .gte('created_at', dateFilter)
        .order('like_count', { ascending: false });

      const { data: clips } = await query;

      const totalViews = (clips ?? []).reduce((sum, c) => sum + (c.view_count || 0), 0);
      const totalLikes = (clips ?? []).reduce((sum, c) => sum + (c.like_count || 0), 0);

      // Get share count from analytics
      const { count: shareCount } = await supabase
        .from('analytics_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('event_name', 'clip_shared')
        .gte('created_at', dateFilter);

      setStats({
        views: totalViews,
        likes: totalLikes,
        shares: shareCount ?? 0,
        followers: profile?.follower_count ?? 0,
      });
      setTopClips((clips ?? []).slice(0, 10));
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  const statCards: StatCard[] = [
    { label: 'Views', value: stats.views, icon: <Eye size={20} color="#3498db" />, color: '#3498db' },
    { label: 'Likes', value: stats.likes, icon: <Heart size={20} color="#e74c3c" />, color: '#e74c3c' },
    { label: 'Shares', value: stats.shares, icon: <Share2 size={20} color="#2ecc71" />, color: '#2ecc71' },
    { label: 'Followers', value: stats.followers, icon: <Users size={20} color="#f39c12" />, color: '#f39c12' },
  ];

  const formatNum = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const periods: { key: TimePeriod; label: string }[] = [
    { key: '7d', label: '7 Days' },
    { key: '30d', label: '30 Days' },
    { key: 'all', label: 'All Time' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Stats</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Period selector */}
      <View style={styles.periodRow}>
        {periods.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodPill, period === p.key && styles.periodPillActive]}
            onPress={() => setPeriod(p.key)}
          >
            <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Stat cards */}
          <View style={styles.statsGrid}>
            {statCards.map((s) => (
              <View key={s.label} style={styles.statCard}>
                {s.icon}
                <Text style={[styles.statValue, { color: s.color }]}>{formatNum(s.value)}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Top clips */}
          <Text style={styles.sectionTitle}>Top Clips</Text>
          {topClips.length === 0 ? (
            <Text style={styles.emptyText}>No clips in this period yet</Text>
          ) : (
            topClips.map((clip, i) => (
              <View key={clip.id} style={styles.clipRow}>
                <Text style={styles.clipRank}>#{i + 1}</Text>
                <View style={styles.clipInfo}>
                  <Text style={styles.clipTitle} numberOfLines={1}>{clip.title}</Text>
                  <Text style={styles.clipMeta}>
                    {formatNum(clip.view_count)} views · {formatNum(clip.like_count)} likes
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  periodRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  periodPill: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.dark.surface, borderWidth: 1, borderColor: Colors.dark.border,
  },
  periodPillActive: { backgroundColor: Colors.dark.accent, borderColor: Colors.dark.accent },
  periodText: { fontSize: 13, color: Colors.dark.textSecondary, fontWeight: '600' },
  periodTextActive: { color: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24,
  },
  statCard: {
    width: '47%', backgroundColor: Colors.dark.surface, borderRadius: 16,
    padding: 16, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  statValue: { fontSize: 28, fontWeight: '900' },
  statLabel: { fontSize: 12, color: Colors.dark.textSecondary, fontWeight: '600' },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 12,
  },
  emptyText: { fontSize: 14, color: Colors.dark.textMuted, textAlign: 'center', marginTop: 20 },
  clipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  clipRank: { fontSize: 16, fontWeight: '700', color: Colors.dark.textMuted, width: 30 },
  clipInfo: { flex: 1 },
  clipTitle: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  clipMeta: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
});
