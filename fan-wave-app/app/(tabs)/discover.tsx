import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { SportPillRow } from '@/components/SportPill';
import { WatchPartyCard } from '@/components/WatchPartyCard';
import { GroupCard } from '@/components/GroupCard';
import { SectionHeader } from '@/components/SectionHeader';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mapWatchPartyToDisplay,
  mapChatRoomToDisplay,
  type WatchPartyDisplay,
  type ChatRoomDisplay,
} from '@/lib/mappers';

const FILTER_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'nfl', label: '🏈 NFL' },
  { id: 'nba', label: '🏀 NBA' },
  { id: 'soccer', label: '⚽ Soccer' },
  { id: 'mlb', label: '⚾ MLB' },
  { id: 'nhl', label: '🏒 NHL' },
];

const CITIES = [
  'Chicago',
  'New York',
  'Los Angeles',
  'Houston',
  'Phoenix',
  'Philadelphia',
  'San Antonio',
  'Dallas',
  'Miami',
  'Atlanta',
  'Denver',
  'Seattle',
  'Boston',
];

const SPORT_ID_MAP: Record<string, string> = {
  nfl: 'NFL',
  nba: 'NBA',
  soccer: 'Soccer',
  mlb: 'MLB',
  nhl: 'NHL',
};

export default function DiscoverScreen() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [city, setCity] = useState('');
  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [groups, setGroups] = useState<ChatRoomDisplay[]>([]);
  const [watchParties, setWatchParties] = useState<WatchPartyDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreParties, setHasMoreParties] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partyCursor, setPartyCursor] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGroups = useCallback(
    async (sport?: string, search?: string) => {
      try {
        const { data, error } = await supabase.rpc('browse_public_groups', {
          // Pass null (not '') when the user hasn't picked a home_city —
          // the RPC's p_city IS NULL branch is the "show all" path.
          p_city: city || null,
          ...(sport && sport !== 'all' ? { p_sport: SPORT_ID_MAP[sport] } : {}),
          ...(search ? { p_search: search } : {}),
          p_limit: 20,
          p_offset: 0,
        });

        if (error) throw error;
        if (data && data.length > 0) {
          return data.map(mapChatRoomToDisplay);
        }
        return [];
      } catch {
        return [];
      }
    },
    [city],
  );

  // Watch parties are filtered by city ONLY — not by sport. The product
  // wants "what's happening near me" surfaced regardless of which league
  // it's tied to. The sport pill at the top still scopes the Groups
  // section, but parties always show the full local lineup.
  // Fallback: when the user has no home_city on file we show all upcoming
  // parties instead of an empty list.
  const fetchWatchParties = useCallback(
    async (_sport?: string, cursor?: string | null) => {
      try {
        const baseSelect = (q: any) =>
          q
            .from('watch_parties')
            .select('*, sport:sports!sport_id(*)')
            .gt('starts_at', cursor || new Date().toISOString())
            .order('starts_at', { ascending: true })
            .limit(20);

        // First try the user's city. If that returns zero, fall back to a
        // nationwide query so Dallas / smaller-metro users don't see a sad
        // empty state (live v5 P2). The hook caller knows the result was
        // broadened because `broadened: true` is returned.
        if (city) {
          const localQuery = baseSelect(supabase).ilike('venue_city', city);
          const { data, error } = await localQuery;
          if (error) throw error;
          const mapped = (data || []).map(mapWatchPartyToDisplay);
          if (mapped.length > 0) {
            return { items: mapped, hasMore: mapped.length === 20, broadened: false };
          }
        }

        const { data: wider, error: widerError } = await baseSelect(supabase);
        if (widerError) throw widerError;
        const mapped = (wider || []).map(mapWatchPartyToDisplay);
        return { items: mapped, hasMore: mapped.length === 20, broadened: !!city };
      } catch {
        return { items: [], hasMore: false, broadened: false };
      }
    },
    [city],
  );

  const loadMoreParties = useCallback(async () => {
    if (!hasMoreParties || loadingMore || !partyCursor) return;
    setLoadingMore(true);
    const { items, hasMore } = await fetchWatchParties(activeFilter, partyCursor);
    setWatchParties((prev) => [...prev, ...items]);
    setHasMoreParties(hasMore);
    if (items.length > 0) {
      setPartyCursor(items[items.length - 1]?.startsAt ?? null);
    }
    setLoadingMore(false);
  }, [hasMoreParties, loadingMore, partyCursor, activeFilter, fetchWatchParties]);

  const [partiesBroadened, setPartiesBroadened] = useState(false);

  const loadData = useCallback(
    async (sport?: string, search?: string) => {
      setLoading(true);
      try {
        const [groupResults, partyResult] = await Promise.all([
          fetchGroups(sport, search),
          fetchWatchParties(sport),
        ]);
        setGroups(groupResults);
        setWatchParties(partyResult.items);
        setHasMoreParties(partyResult.hasMore);
        setPartiesBroadened(!!partyResult.broadened);
        if (partyResult.items.length > 0) {
          setPartyCursor(partyResult.items[partyResult.items.length - 1]?.startsAt ?? null);
        } else {
          setPartyCursor(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchGroups, fetchWatchParties],
  );

  // Load city from AsyncStorage on mount. Stay empty when the user hasn't
  // gone through onboarding-city yet — the watch_parties query falls back
  // to "all upcoming" so Discover isn't blank for them.
  useEffect(() => {
    AsyncStorage.getItem('user_city').then((stored) => {
      setCity(stored || '');
    });
  }, []);

  // Initial load — fire whenever city resolves, even if it's empty so the
  // fallback (show all watch parties) actually renders for cityless users.
  useEffect(() => {
    loadData(activeFilter);
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = useCallback(
    (filterId: string) => {
      setActiveFilter(filterId);
      loadData(filterId, searchQuery);
    },
    [loadData, searchQuery],
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        loadData(activeFilter, text);
      }, 300);
    },
    [activeFilter, loadData],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(activeFilter, searchQuery);
    setRefreshing(false);
  }, [activeFilter, loadData, searchQuery]);

  const handleCitySelect = useCallback((selectedCity: string) => {
    setCity(selectedCity);
    AsyncStorage.setItem('user_city', selectedCity);
    setCityModalVisible(false);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <TouchableOpacity
          onPress={() => setCityModalVisible(true)}
          style={styles.subtitleRow}
          activeOpacity={0.7}
        >
          <MapPin size={14} color={Colors.dark.textSecondary} />
          <Text style={styles.subtitle}>
            {' '}
            {city || 'Pick a city'} ·{' '}
            <Text style={styles.visitingLink}>I'm visiting...</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Search size={18} color={Colors.dark.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search groups, watch parties, venues..."
          placeholderTextColor={Colors.dark.textMuted}
          value={searchQuery}
          onChangeText={handleSearchChange}
          returnKeyType="search"
        />
      </View>

      <View style={styles.pillContainer}>
        <SportPillRow
          pills={FILTER_PILLS}
          activeId={activeFilter}
          onSelect={handleFilterChange}
        />
      </View>

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.dark.accent}
              colors={[Colors.dark.accent]}
            />
          }
        >
          <SectionHeader
            title={city ? `Trending Groups in ${city}` : 'Trending Groups'}
            actionText="See All →"
          />
          {groups.length > 0 ? (
            groups.slice(0, 4).map((group) => (
              <GroupCard key={group.id} group={group} showUnread={false} />
            ))
          ) : (
            <Text style={styles.emptyText}>No groups here yet — be the first to start one!</Text>
          )}

          <SectionHeader
            title={
              partiesBroadened
                ? 'Watch Parties · Nearby (broader area)'
                : city
                  ? `Watch Parties Near You · ${city}`
                  : 'Upcoming Watch Parties'
            }
            actionText="Map View 🗺️"
          />
          {watchParties.length > 0 ? (
            watchParties.map((party) => (
              <WatchPartyCard key={party.id} party={party} />
            ))
          ) : (
            <Text style={styles.emptyText}>No watch parties yet — host the first one!</Text>
          )}

          <View style={styles.spacer} />
        </ScrollView>
      )}

      {/* City selector modal */}
      <Modal
        visible={cityModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCityModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setCityModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select a City</Text>
            <ScrollView style={styles.cityList}>
              {CITIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.cityOption,
                    c === city && styles.cityOptionActive,
                  ]}
                  onPress={() => handleCitySelect(c)}
                  activeOpacity={0.7}
                >
                  <MapPin
                    size={16}
                    color={
                      c === city
                        ? Colors.dark.accent
                        : Colors.dark.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.cityOptionText,
                      c === city && styles.cityOptionTextActive,
                    ]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setCityModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  visitingLink: {
    color: Colors.dark.accent,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.dark.text,
  },
  pillContainer: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  spacer: {
    height: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.dark.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.dark.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  cityList: {
    flexGrow: 0,
  },
  cityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 4,
  },
  cityOptionActive: {
    backgroundColor: Colors.dark.background,
  },
  cityOptionText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  cityOptionTextActive: {
    color: Colors.dark.accent,
    fontWeight: '600',
  },
  modalClose: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.background,
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.textMuted,
  },
});
