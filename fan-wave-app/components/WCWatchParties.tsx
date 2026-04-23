import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Search, Share2 } from 'lucide-react-native';
import { shareWatchParty } from '@/lib/sharing';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────

interface WCWatchPartyAttendee {
  initials: string;
  color: string;
}

interface WCWatchPartyItem {
  id: string;
  title: string;
  venue: string;
  city: string;
  date: string;
  time: string;
  rsvpCount: number;
  capacity: number;
  atmosphere: string;
  attendees: WCWatchPartyAttendee[];
  matchEvent?: string;
}

// ── City filter pills ──────────────────────────────────────

const CITY_PILLS = [
  'All Cities',
  'Near Me',
  'New York',
  'Los Angeles',
  'Chicago',
  'Dallas',
  'Houston',
  'Miami',
  'Toronto',
  'Mexico City',
];

// ── Component ──────────────────────────────────────────────

export default function WCWatchParties() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCity, setActiveCity] = useState('All Cities');
  const [parties, setParties] = useState<WCWatchPartyItem[]>([]);
  const [rsvpMap, setRsvpMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // ── Supabase fetch attempt ─────────────────────────────

  useEffect(() => {
    fetchParties();
  }, []);

  const fetchParties = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('watch_parties')
        .select('*')
        .ilike('event', '%World Cup%');

      if (!error && data) {
        const mapped: WCWatchPartyItem[] = data.map((p: any) => ({
          id: p.id,
          title: p.title || p.name,
          venue: p.venue || 'TBD',
          city: p.city || '',
          date: p.date || '',
          time: p.time || '',
          rsvpCount: p.rsvp_count || 0,
          capacity: p.capacity || 50,
          atmosphere: p.atmosphere || 'Chill',
          attendees: [],
          matchEvent: p.event,
        }));
        setParties(mapped);
      }
    } catch {
      // Supabase unavailable — keep empty state
    } finally {
      setLoading(false);
    }
  };

  // ── Filtering ──────────────────────────────────────────

  const filteredParties = parties.filter((p) => {
    const matchesCity =
      activeCity === 'All Cities' || activeCity === 'Near Me' || p.city === activeCity;
    const matchesSearch =
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.venue.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCity && matchesSearch;
  });

  // ── RSVP handler ───────────────────────────────────────

  const handleRsvp = async (partyId: string) => {
    const isCurrentlyRsvp = rsvpMap[partyId];
    const nextState = !isCurrentlyRsvp;

    try {
      const { error } = await supabase.rpc('rsvp_to_watch_party', {
        p_watch_party_id: partyId,
        p_status: nextState ? 'going' : 'none',
      });
      if (error) {
        console.warn('RSVP RPC failed, using local fallback:', error.message);
      }
    } catch {
      console.warn('RSVP RPC unavailable, using local fallback');
    }

    setRsvpMap((prev) => ({ ...prev, [partyId]: nextState }));
  };

  // ── Render card ────────────────────────────────────────

  const renderPartyCard = ({ item }: { item: WCWatchPartyItem }) => {
    const isRsvp = rsvpMap[item.id] || false;
    const displayCount = isRsvp ? item.rsvpCount + 1 : item.rsvpCount;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/watch-party/${item.id}` as any)}
      >
        <View style={styles.topRow}>
          <View style={styles.sportBadge}>
            <Text style={styles.sportBadgeText}>⚽ WORLD CUP</Text>
          </View>
          <TouchableOpacity
            style={[styles.rsvpButton, isRsvp && styles.rsvpButtonActive]}
            onPress={() => handleRsvp(item.id)}
          >
            <Text style={styles.rsvpButtonText}>
              {isRsvp ? '✓ Going' : 'RSVP'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.venue}>
          📍 {item.venue} · {item.city}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>📅 {item.date} · {item.time}</Text>
          <Text style={styles.meta}>
            👥 {displayCount}/{item.capacity}
          </Text>
        </View>

        <View style={styles.atmosphereRow}>
          <View style={styles.atmospherePill}>
            <Text style={styles.atmosphereText}>{item.atmosphere}</Text>
          </View>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => shareWatchParty({ id: item.id, title: item.title, venue: item.venue, city: item.city, date: item.date })}
          >
            <Share2 size={14} color={Colors.dark.textSecondary} />
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.attendeeRow}>
          {item.attendees.map((a, i) => (
            <View
              key={i}
              style={[
                styles.attendeeAvatar,
                { backgroundColor: a.color, marginLeft: i > 0 ? -8 : 0 },
              ]}
            >
              <Text style={styles.attendeeText}>{a.initials}</Text>
            </View>
          ))}
          {item.rsvpCount > item.attendees.length && (
            <View
              style={[
                styles.attendeeAvatar,
                { backgroundColor: Colors.dark.textMuted, marginLeft: -8 },
              ]}
            >
              <Text style={styles.attendeeText}>
                +{item.rsvpCount - item.attendees.length}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Empty state ────────────────────────────────────────

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accentGreen} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>⚽</Text>
        <Text style={styles.emptyTitle}>No World Cup watch parties yet</Text>
        <Text style={styles.emptySubtitle}>Be the first to create one!</Text>
      </View>
    );
  };

  // ── Main render ────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Search size={18} color={Colors.dark.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search WC watch parties..."
          placeholderTextColor={Colors.dark.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* City filter pills */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CITY_PILLS}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.pillRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.pill, activeCity === item && styles.pillActive]}
            onPress={() => setActiveCity(item)}
          >
            <Text
              style={[styles.pillText, activeCity === item && styles.pillTextActive]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Watch party list */}
      <FlatList
        data={filteredParties}
        keyExtractor={(item) => item.id}
        renderItem={renderPartyCard}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/create-watch-party' as any)}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14,
  },
  pillRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  pill: {
    width: 110,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  pillActive: {
    backgroundColor: Colors.dark.accentGreen,
    borderColor: Colors.dark.accentGreen,
  },
  pillText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sportBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: `${Colors.dark.accentGreen}22`,
  },
  sportBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.accentGreen,
  },
  rsvpButton: {
    backgroundColor: Colors.dark.accentGreen,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  rsvpButtonActive: {
    backgroundColor: Colors.dark.accentGreenDark,
  },
  rsvpButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  venue: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  atmosphereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
  shareBtnText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  atmospherePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.dark.surfaceLight,
  },
  atmosphereText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  attendeeRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  attendeeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '600',
    marginTop: -2,
  },
});
