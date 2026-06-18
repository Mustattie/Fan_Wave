import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';

interface RSVP {
  id: string;
  watch_party_id: string;
  status: 'going' | 'interested' | 'declined';
  title: string;
  venue: string;
  city: string;
  starts_at: string;
  sport: string;
  sport_emoji: string;
  sport_color: string;
}

export default function RSVPHistoryScreen() {
  const router = useRouter();
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRsvps();
  }, []);

  const loadRsvps = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // watch_party_rsvps.user_id stores auth.users.id (the RPC at
        // migration 059 writes auth.uid() and create-watch-party.tsx
        // auto-RSVP writes the same). The earlier "fix" to look up
        // public.users.id was a regression — reverted to user.id here
        // so the new mig-059 RSVPs actually surface. v8.2 P0 was the
        // RPC 404-ing (different bug, fixed by mig 059), not a column
        // mismatch.
        const { data, error } = await supabase
          .from('watch_party_rsvps')
          .select(`
            id,
            status,
            watch_party_id,
            watch_parties (
              id,
              title,
              venue_name,
              city,
              starts_at,
              sport,
              sport_emoji
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (data && !error && data.length > 0) {
          const mapped: RSVP[] = data.map((r: any) => {
            const wp = r.watch_parties;
            const sportColorMap: Record<string, string> = {
              NFL: Colors.dark.nfl,
              NBA: Colors.dark.nba,
              Soccer: Colors.dark.soccer,
              MLB: Colors.dark.mlb,
              NHL: Colors.dark.nhl,
            };
            return {
              id: r.id,
              watch_party_id: r.watch_party_id,
              status: r.status,
              title: wp?.title || 'Watch Party',
              venue: wp?.venue_name || '',
              city: wp?.city || '',
              starts_at: wp?.starts_at || '',
              sport: wp?.sport || 'NFL',
              sport_emoji: wp?.sport_emoji || '🏈',
              sport_color: sportColorMap[wp?.sport] || Colors.dark.accent,
            };
          });
          setRsvps(mapped);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Error loading RSVPs
    }
    setRsvps([]);
    setLoading(false);
  };

  const now = new Date();
  const upcoming = rsvps.filter((r) => new Date(r.starts_at) >= now);
  const past = rsvps.filter((r) => new Date(r.starts_at) < now);

  const sections = [
    ...(upcoming.length > 0 ? [{ title: 'Upcoming', data: upcoming }] : []),
    ...(past.length > 0 ? [{ title: 'Past', data: past }] : []),
  ];

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    going: { label: 'Going', bg: Colors.dark.accent, text: '#fff' },
    interested: { label: 'Interested', bg: Colors.dark.warning, text: '#000' },
    declined: { label: 'Declined', bg: Colors.dark.textMuted, text: '#fff' },
  };

  const renderItem = ({ item }: { item: RSVP }) => {
    const status = statusConfig[item.status] || statusConfig.going;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/watch-party/${item.watch_party_id}` as any)}
      >
        <View style={styles.cardTop}>
          <View style={[styles.sportBadge, { backgroundColor: item.sport_color + '22' }]}>
            <Text style={styles.sportEmoji}>{item.sport_emoji}</Text>
            <Text style={[styles.sportName, { color: item.sport_color }]}>{item.sport}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
          </View>
        </View>

        <Text style={styles.cardTitle}>{item.title}</Text>

        <View style={styles.cardDetail}>
          <MapPin size={14} color={Colors.dark.textSecondary} />
          <Text style={styles.cardDetailText}>
            {item.venue} · {item.city}
          </Text>
        </View>

        <View style={styles.cardDetail}>
          <Calendar size={14} color={Colors.dark.textSecondary} />
          <Text style={styles.cardDetailText}>{formatDate(item.starts_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <Text style={styles.sectionHeader}>{section.title}</Text>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>RSVP History</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : rsvps.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No watch parties on your calendar yet — find your spot!</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surface,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  list: {
    padding: 16,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 12,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sportEmoji: {
    fontSize: 14,
  },
  sportName: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  cardDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardDetailText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
});
