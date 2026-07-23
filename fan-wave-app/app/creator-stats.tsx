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
  hint: string;
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

      // v9.2.2: window applies to ENGAGEMENT TIMESTAMPS, not clip
      // creation date. A viral evergreen clip posted 6 months ago that
      // earned 10k likes today should show those 10k likes under
      // "7 Days" -- creators care about growth, not just recent posts.
      // The previous filter (media_clips.created_at >= cutoff) hid all
      // engagement on clips older than the window.
      const sinceISO = period === '7d'
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        : period === '30d'
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          : '1970-01-01T00:00:00Z';

      // Single RPC returns views + likes + shares + followers scoped
      // to the current auth user's own clips (SECURITY DEFINER inside).
      const { data: statsRow, error: statsErr } = await supabase.rpc(
        'get_creator_stats',
        { p_since: sinceISO },
      );
      if (statsErr) throw statsErr;
      const row = Array.isArray(statsRow) ? statsRow[0] : statsRow;

      // Top Clips list continues to filter by clip creation date so
      // it stays honest as a "clips I posted in this window" leaderboard.
      // Lifetime counters (view_count / like_count / share_count) on each
      // row are the still-correct display for the tiles below.
      const { data: clips } = await supabase
        .from('media_clips')
        .select('id, title, view_count, like_count, share_count, created_at')
        .eq('user_id', user.id)
        .gte('created_at', sinceISO)
        .order('like_count', { ascending: false });

      setStats({
        views: Number(row?.total_views ?? 0),
        likes: Number(row?.total_likes ?? 0),
        shares: Number(row?.total_shares ?? 0),
        followers: Number(row?.followers ?? 0),
      });
      setTopClips((clips ?? []).slice(0, 10));
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  const statCards: StatCard[] = [
    { label: 'Views',     hint: 'on your clips',   value: stats.views,     icon: <Eye size={20} color="#3498db" />,    color: '#3498db' },
    { label: 'Likes',     hint: 'on your clips',   value: stats.likes,     icon: <Heart size={20} color="#e74c3c" />,  color: '#e74c3c' },
    { label: 'Shares',    hint: 'of your clips',   value: stats.shares,    icon: <Share2 size={20} color="#2ecc71" />, color: '#2ecc71' },
    { label: 'Followers', hint: 'following you',   value: stats.followers, icon: <Users size={20} color="#f39c12" />,  color: '#f39c12' },
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
          {/* v9.1 UAT: users mistook zeros for "system not capturing my
              likes/follows." These are CREATOR stats — engagement on the
              user's own posted clips + accounts following them, not the
              user's own engagement history. Hint line disambiguates. */}
          <Text style={styles.statsCaption}>
            Engagement on your posts. Liking or following other creators doesn't
            show up here — it's their stats, not yours.
          </Text>
          <View style={styles.statsGrid}>
            {statCards.map((s) => (
              <View key={s.label} style={styles.statCard}>
                {s.icon}
                <Text style={[styles.statValue, { color: s.color }]}>{formatNum(s.value)}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
                <Text style={styles.statHint}>{s.hint}</Text>
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
  statHint: { fontSize: 10, color: Colors.dark.textMuted, textAlign: 'center' },
  statsCaption: {
    fontSize: 12, color: Colors.dark.textSecondary, marginBottom: 12,
    lineHeight: 16, paddingHorizontal: 2,
  },
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
