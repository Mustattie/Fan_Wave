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
import { WCPassPaywall } from '@/components/paywall/WCPassPaywall';
import { useHasWCAccess } from '@/lib/entitlements';

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
  // WC-pass paywall surfaces when a free user RSVPs to a Soccer Cup party
  // or taps the FAB to host one — migration 053 enforces this server-side
  // via watch_party_rsvps_insert / watch_parties_insert RLS; we mirror the
  // outcome client-side so the user sees the upgrade modal instead of a
  // silent failure (v8.1 P0).
  const [showWCPaywall, setShowWCPaywall] = useState(false);
  const hasWCAccess = useHasWCAccess();

  // ── Supabase fetch attempt ─────────────────────────────

  useEffect(() => {
    fetchParties();
  }, []);

  const fetchParties = async () => {
    setLoading(true);
    try {
      // Filter by the seeded Soccer Cup event_id (from migration 006).
      // Previously this used .ilike('event', ...) — but 'event' is not a
      // column on watch_parties (real cols: event_id, sport_id, title,
      // venue_name, venue_city, starts_at). The bad filter silently
      // errored and the tab showed "No Soccer Cup watch parties yet" even
      // when matching rows existed (Apple build-9 / live Android v5 P0).
      // Soccer Cup 2026 event UUID — must match the seeded row in events.
      // Previously the wrong prefix (e0260000) was used, which silently
      // bypassed the migration 053 watch_party_rsvps WC gate and made
      // newly-created Soccer Cup parties invisible to the DB-side query.
      const { WC_EVENT_ID: SOCCER_CUP_EVENT_ID } = await import('@/constants/WorldCupIds');
      // Soccer sport_id (seed migration 006) — accept parties tagged via
      // either event_id OR sport_id so a watch party created from the
      // generic FAB that the user marked as "soccer" still shows on the
      // Soccer Cup tab.
      const SOCCER_SPORT_ID = 'a0000000-0000-0000-0000-000000000004';
      // v8.5 P0: 2h grace period — same fix as useWatchParties (a host who
      // picked "Tonight 7PM" at 7:48 PM should still see their own party).
      const startedAfter = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('watch_parties')
        .select('*')
        .or(`event_id.eq.${SOCCER_CUP_EVENT_ID},sport_id.eq.${SOCCER_SPORT_ID}`)
        .gt('starts_at', startedAfter)
        .order('starts_at', { ascending: true });

      if (!error && data) {
        const mapped: WCWatchPartyItem[] = data.map((p: any) => {
          const starts = p.starts_at ? new Date(p.starts_at) : null;
          return {
            id: p.id,
            title: p.title || 'Watch Party',
            venue: p.venue_name || 'TBD',
            city: p.venue_city || '',
            date: starts ? starts.toLocaleDateString() : '',
            time: starts ? starts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
            rsvpCount: p.rsvp_count || 0,
            capacity: p.capacity || 50,
            atmosphere: p.atmosphere || 'Chill',
            attendees: [],
            matchEvent: 'Soccer Cup 2026',
          };
        });
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
    // Client-side WC-pass check — mirrors the migration 053 RLS gate so
    // free users get the WCPassPaywall instead of a silent error toast.
    if (!hasWCAccess) {
      setShowWCPaywall(true);
      return;
    }

    const isCurrentlyRsvp = rsvpMap[partyId];
    const nextState = !isCurrentlyRsvp;

    try {
      // Migration 059 standardised the RPC to a 2-arg (p_party_id, p_status)
      // signature. Previously this call used p_watch_party_id and was 404-ing
      // silently through PostgREST.
      const { error } = await supabase.rpc('rsvp_to_watch_party', {
        p_party_id: partyId,
        p_status: nextState ? 'going' : 'none',
      });
      if (error) {
        // 42501 = WC-pass RLS gate from migration 053. Surface the paywall
        // instead of letting the optimistic toggle stick.
        if (
          error.code === '42501' ||
          /row-level security/i.test(error.message ?? '')
        ) {
          setShowWCPaywall(true);
          return;
        }
        console.warn('RSVP RPC failed, using local fallback:', error.message);
      }
    } catch {
      console.warn('RSVP RPC unavailable, using local fallback');
    }

    setRsvpMap((prev) => ({ ...prev, [partyId]: nextState }));
  };

  const handleCreateParty = () => {
    // Same WC-pass gate for hosting — migration 053 watch_parties_insert.
    if (!hasWCAccess) {
      setShowWCPaywall(true);
      return;
    }
    router.push('/create-watch-party?event=soccer-cup-2026' as any);
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
        <Text style={styles.emptyTitle}>No Soccer Cup watch parties yet</Text>
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
          placeholder="Search Soccer Cup watch parties..."
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

      {/* FAB — guarded by handleCreateParty so free users see the
          WCPassPaywall instead of bouncing off RLS at create time. */}
      <TouchableOpacity
        style={styles.fab}
        onPress={handleCreateParty}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <WCPassPaywall
        visible={showWCPaywall}
        onClose={() => setShowWCPaywall(false)}
      />
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
