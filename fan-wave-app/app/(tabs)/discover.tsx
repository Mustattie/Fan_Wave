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
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Search, MapPin, Plus, X, Users, UserPlus } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import {
  loadContactsWithPhones,
  pickPhoneForContact,
  openSmsInvite,
  buildGroupInviteBody,
} from '@/lib/inviteContacts';
import { Colors } from '@/constants/Colors';
import { SportPillRow } from '@/components/SportPill';
import { WatchPartyCard } from '@/components/WatchPartyCard';
import { GroupCard } from '@/components/GroupCard';
import { SectionHeader } from '@/components/SectionHeader';
import { supabase } from '@/lib/supabase';
import { subscribeToWatchParties } from '@/lib/realtime';
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

// Sport list used inside the Create Group modal (matches the legacy
// (tabs)/groups.tsx pattern for parity with the create-flow the modal
// replaces).
const SPORT_PILLS = [
  { id: 'nfl', label: 'NFL 🏈', emoji: '🏈' },
  { id: 'nba', label: 'NBA 🏀', emoji: '🏀' },
  { id: 'soccer', label: 'Soccer ⚽', emoji: '⚽' },
  { id: 'mlb', label: 'MLB ⚾', emoji: '⚾' },
];

const VISIBILITY_OPTIONS = [
  { id: 'public', label: '🌍 Public' },
  { id: 'private', label: '🔒 Private' },
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
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('all');
  const [city, setCity] = useState('');
  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [watchParties, setWatchParties] = useState<WatchPartyDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreParties, setHasMoreParties] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [partyCursor, setPartyCursor] = useState<string | null>(null);

  // Fan Groups section (lifted from (tabs)/groups.tsx for v9.0 tab-swap).
  // Joined sub-tab: user's memberships; Suggested sub-tab: public groups
  // the user hasn't joined yet. Renamed from "Discover" → "Suggested" so
  // the sub-tab label doesn't collide with the tab we're already on.
  const [groupsTab, setGroupsTab] = useState<'joined' | 'suggested'>('suggested');
  const [myGroups, setMyGroups] = useState<ChatRoomDisplay[]>([]);
  const [suggestedGroups, setSuggestedGroups] = useState<ChatRoomDisplay[]>([]);
  const [loadingMyGroups, setLoadingMyGroups] = useState(true);
  const [loadingSuggested, setLoadingSuggested] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showAllGroupsModal, setShowAllGroupsModal] = useState(false);

  // Create Group modal state (lifted verbatim from groups.tsx)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedSport, setSelectedSport] = useState('nfl');
  const [selectedVisibility, setSelectedVisibility] = useState('public');
  const [isCreating, setIsCreating] = useState(false);
  // City used inside the Create Group form. Prefilled from the outer
  // `city` state (home_city / AsyncStorage) but the user can override
  // per-group without polluting the top-level Discover city filter.
  const [createGroupCity, setCreateGroupCity] = useState('');
  // Private-group contact invite state
  const [invitedFriends, setInvitedFriends] = useState<{ name: string; phone: string }[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.ExistingContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  // Team search
  const [teamQuery, setTeamQuery] = useState('');
  const [teamResults, setTeamResults] = useState<
    { id: string; name: string; logo_url?: string }[]
  >([]);
  const [selectedTeam, setSelectedTeam] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [teamSearchLoading, setTeamSearchLoading] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v8.7+ P0: track which groups the current user is already a member of
  // so the Suggested Groups Join CTA renders "✓ Joined" instead of "Join"
  // on cards the user already belongs to.
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());

  // Watch parties are filtered by city ONLY — not by sport. The product
  // wants "what's happening near me" surfaced regardless of which league
  // it's tied to. The sport pill at the top still scopes the Groups
  // section, but parties always show the full local lineup.
  //
  // v8.7+ P0: also accepts a search string so the global search bar
  // filters Watch Parties + Venues (party.venue_name) too.
  const fetchWatchParties = useCallback(
    async (_sport?: string, cursor?: string | null, search?: string) => {
      try {
        // v8.5 P0: 2h grace so freshly-hosted parties (whose preset clock
        // may already be a few minutes past at create-time) stay visible
        // until the event actually plays out.
        const startedAfter =
          cursor || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const applySearch = (q: any) => {
          if (!search) return q;
          const safe = search.replace(/[%,]/g, ' ').trim();
          if (!safe) return q;
          return q.or(
            `title.ilike.%${safe}%,venue_name.ilike.%${safe}%,venue_city.ilike.%${safe}%`,
          );
        };
        const baseSelect = (q: any) =>
          applySearch(
            q
              .from('watch_parties')
              .select('*, sport:sports!sport_id(*)')
              .gt('starts_at', startedAfter),
          )
            .order('starts_at', { ascending: true })
            .limit(20);

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

  // Fetch Fan Groups: BOTH joined (my groups) AND suggested (public,
  // not already a member of). Lifted from (tabs)/groups.tsx for the v9.0
  // consolidation. Sport pill scopes the Suggested list; the top-level
  // search box further narrows by name.
  const fetchFanGroups = useCallback(
    async (sport?: string, search?: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { joined: [], suggested: [] };
      }

      // My groups
      let joined: ChatRoomDisplay[] = [];
      try {
        const { data, error } = await supabase
          .from('chat_room_members')
          .select('chat_rooms(*)')
          .eq('user_id', user.id);
        if (!error && data) {
          joined = data
            .map((row: any) => row.chat_rooms)
            .filter(Boolean)
            .map(mapChatRoomToDisplay);
        }
      } catch {
        joined = [];
      }

      // Suggested groups (public, not owned by user, not already joined).
      // v8.2 pattern: query chat_rooms directly rather than the RPC so a
      // missing/buggy RPC can't silently zero the list.
      let suggested: ChatRoomDisplay[] = [];
      try {
        // Exclude worldcup-typed groups from Suggested. Per v9.x pivot WC
        // is hidden from the UI (mig 053 chat_room_members_insert still
        // requires has_wc_access for group_type='worldcup', so surfacing
        // them here just teased users into a 42501 that read "Could not
        // join. Please try again." after v9.1's GroupCard cleanup.
        let query = supabase
          .from('chat_rooms')
          .select('*')
          .eq('visibility', 'public')
          .neq('group_type', 'worldcup')
          .order('member_count', { ascending: false })
          .limit(30);

        // Sport filter — resolve sport_id from the top-level pill
        if (sport && sport !== 'all') {
          const sportName = SPORT_ID_MAP[sport];
          if (sportName) {
            const { data: sportRow } = await supabase
              .from('sports')
              .select('id')
              .ilike('name', sportName)
              .maybeSingle();
            if (sportRow?.id) {
              query = query.eq('sport_id', sportRow.id);
            }
          }
        }

        // Search filter (name ilike)
        if (search && search.trim()) {
          const safe = search.replace(/[%,]/g, ' ').trim();
          if (safe) {
            query = query.ilike('name', `%${safe}%`);
          }
        }

        const { data, error } = await query;
        if (!error && data) {
          const memberIds = new Set(joined.map((g) => g.id));
          suggested = (data || [])
            .filter(
              (g: any) =>
                !memberIds.has(g.id) && g.owner_id !== user.id,
            )
            .map(mapChatRoomToDisplay);
        }
      } catch {
        suggested = [];
      }

      return { joined, suggested };
    },
    [],
  );

  const loadMoreParties = useCallback(async () => {
    if (!hasMoreParties || loadingMore || !partyCursor) return;
    setLoadingMore(true);
    const { items, hasMore } = await fetchWatchParties(activeFilter, partyCursor, searchQuery);
    setWatchParties((prev) => [...prev, ...items]);
    setHasMoreParties(hasMore);
    if (items.length > 0) {
      setPartyCursor(items[items.length - 1]?.startsAt ?? null);
    }
    setLoadingMore(false);
  }, [hasMoreParties, loadingMore, partyCursor, activeFilter, fetchWatchParties, searchQuery]);

  const [partiesBroadened, setPartiesBroadened] = useState(false);

  const handleGroupJoined = useCallback((groupId: string) => {
    setMyGroupIds((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
    // Move the group from Suggested → Joined locally so the sub-tab
    // counts update without a refetch round-trip.
    setSuggestedGroups((prev) => {
      const joined = prev.find((g) => g.id === groupId);
      if (joined) {
        setMyGroups((mg) => {
          if (mg.some((g) => g.id === groupId)) return mg;
          return [joined, ...mg];
        });
      }
      return prev.filter((g) => g.id !== groupId);
    });
  }, []);

  const loadData = useCallback(
    async (sport?: string, search?: string) => {
      setLoading(true);
      setLoadingMyGroups(true);
      setLoadingSuggested(true);
      try {
        const [groupResults, partyResult] = await Promise.all([
          fetchFanGroups(sport, search),
          fetchWatchParties(sport, null, search),
        ]);
        setMyGroups(groupResults.joined);
        setSuggestedGroups(groupResults.suggested);
        setMyGroupIds(new Set(groupResults.joined.map((g) => g.id)));
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
        setLoadingMyGroups(false);
        setLoadingSuggested(false);
      }
    },
    [fetchFanGroups, fetchWatchParties],
  );

  // Resolve the current auth user id so the Create Group flow + Join CTA
  // ownership check work correctly.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
    })();
  }, []);

  // Load city — prefer users.home_city from Supabase, fall back to
  // AsyncStorage cache (offline UX). Never default to a hardcoded city.
  useEffect(() => {
    const loadCity = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('users')
            .select('home_city')
            .eq('auth_id', user.id)
            .single();
          const homeCity = (data?.home_city ?? '').toString().trim();
          if (homeCity) {
            setCity(homeCity);
            setCreateGroupCity(homeCity);
            AsyncStorage.setItem('user_city', homeCity).catch(() => {});
            return;
          }
        }
        const stored = await AsyncStorage.getItem('user_city');
        if (stored) {
          setCity(stored);
          setCreateGroupCity(stored);
        }
      } catch {
        const stored = await AsyncStorage.getItem('user_city');
        if (stored) {
          setCity(stored);
          setCreateGroupCity(stored);
        }
      }
    };
    loadCity();
  }, []);

  // Initial load — fire whenever city resolves, even if it's empty so the
  // fallback (show all watch parties) actually renders for cityless users.
  useEffect(() => {
    loadData(activeFilter);
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  // v8.7 P0: refetch on tab focus so a watch party created on another
  // screen (Home + create-watch-party) surfaces immediately.
  useFocusEffect(
    useCallback(() => {
      loadData(activeFilter, searchQuery);
    }, [activeFilter, searchQuery, loadData]),
  );

  // v8.7 P0: realtime — mirror new watch parties into local state.
  useEffect(() => {
    if (!city) return;
    const unsubscribe = subscribeToWatchParties(city, (row) => {
      const display = mapWatchPartyToDisplay(row);
      setWatchParties((prev) => {
        if (prev.some((p) => p.id === display.id)) return prev;
        return [display, ...prev];
      });
    });
    return unsubscribe;
  }, [city]);

  // Team search with debounce (Create Group modal)
  useEffect(() => {
    if (!teamQuery || teamQuery.length < 2) {
      setTeamResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setTeamSearchLoading(true);
      try {
        const { data, error } = await supabase
          .from('teams')
          .select('id, name, logo_url')
          .ilike('name', `%${teamQuery}%`)
          .limit(8);
        if (error) throw error;
        setTeamResults(data || []);
      } catch {
        setTeamResults([]);
      } finally {
        setTeamSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [teamQuery]);

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
    setCreateGroupCity(selectedCity);
    AsyncStorage.setItem('user_city', selectedCity);
    setCityModalVisible(false);
  }, []);

  const isGroupNameValid =
    newGroupName.trim().length >= 3 && newGroupName.trim().length <= 50;

  const handleOpenCreateModal = () => {
    setNewGroupName('');
    setTeamQuery('');
    setSelectedTeam(null);
    setTeamResults([]);
    setInvitedFriends([]);
    // Prefill the modal's city with the outer Discover city (home_city)
    setCreateGroupCity(city);
    setShowCreateModal(true);
  };

  const handleCreateGroup = async () => {
    if (!isGroupNameValid) return;
    setIsCreating(true);

    const sportEmoji =
      SPORT_PILLS.find((s) => s.id === selectedSport)?.emoji || '🏈';

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Look up sport_id from sport key
      let sportId: string | null = null;
      if (selectedSport && selectedSport !== 'all') {
        const sportNameMap: Record<string, string> = {
          nfl: 'NFL', nba: 'NBA', mlb: 'MLB', mls: 'MLS', nhl: 'NHL',
          soccer: 'Soccer', cfb: 'College Football', cbb: 'College Basketball', ufc: 'UFC',
        };
        const sportName = sportNameMap[selectedSport];
        if (sportName) {
          const { data: sportRow } = await supabase
            .from('sports').select('id').ilike('name', sportName).maybeSingle();
          sportId = sportRow?.id ?? null;
        }
      }

      const { data: room, error: roomError } = await supabase
        .from('chat_rooms')
        .insert({
          name: newGroupName.trim(),
          group_type: 'sports',
          sport_id: sportId,
          team_id: selectedTeam?.id || null,
          city: createGroupCity,
          visibility: selectedVisibility || 'public',
          avatar_url: sportEmoji,
          owner_id: user.id,
          member_count: 1,
        })
        .select()
        .single();

      if (roomError) throw roomError;

      const { error: memberError } = await supabase
        .from('chat_room_members')
        .insert({
          chat_room_id: room.id,
          user_id: user.id,
          role: 'owner',
        });

      if (memberError) throw memberError;

      // Add to local state
      setMyGroups((prev) => [mapChatRoomToDisplay(room), ...prev]);
      setMyGroupIds((prev) => {
        const next = new Set(prev);
        next.add(room.id);
        return next;
      });

      // Dispatch SMS invites for private groups
      if (selectedVisibility === 'private' && invitedFriends.length > 0) {
        await openSmsInvite(
          invitedFriends,
          buildGroupInviteBody({ id: room.id, name: newGroupName.trim() }),
        );
      }

      setNewGroupName('');
      setTeamQuery('');
      setSelectedTeam(null);
      setTeamResults([]);
      setInvitedFriends([]);
      setShowCreateModal(false);
    } catch (e: any) {
      // v9.1 UAT pivot: creating a fan group is a free-tier action.
      // Migration 070 drops the has_premium_access gate on
      // chat_rooms_insert so this catch only fires on genuine errors.
      Alert.alert('Error', 'Could not create group. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const openContactPicker = useCallback(async () => {
    setContactPickerOpen(true);
    setContactsLoading(true);
    const list = await loadContactsWithPhones();
    if (list === null) {
      setContactPickerOpen(false);
      setContactsLoading(false);
      return;
    }
    setContactsList(list);
    setContactsLoading(false);
  }, []);

  const addContactToInvites = useCallback((name: string, phone: string) => {
    const cleaned = phone.replace(/\s+/g, '');
    setInvitedFriends((prev) => {
      if (prev.some((f) => f.phone.replace(/\s+/g, '') === cleaned)) return prev;
      return [...prev, { name, phone }];
    });
  }, []);

  const handlePickContact = useCallback(
    async (contact: Contacts.Contact) => {
      const picked = await pickPhoneForContact(contact);
      if (picked) {
        addContactToInvites(picked.name, picked.phone);
        setContactPickerOpen(false);
      }
    },
    [addContactToInvites],
  );

  const removeInvite = useCallback((phone: string) => {
    setInvitedFriends((prev) => prev.filter((f) => f.phone !== phone));
  }, []);

  // Which list feeds the Fan Groups carousel + See All modal.
  const activeGroups = groupsTab === 'joined' ? myGroups : suggestedGroups;
  const carouselGroups = activeGroups.slice(0, 8);

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
          {/* Fan Groups section (v9.0 — lifted from (tabs)/groups.tsx) */}
          <View style={styles.groupsSectionHeader}>
            <Text style={styles.groupsSectionTitle}>Fan Groups</Text>
            <TouchableOpacity
              style={styles.createGroupBtn}
              onPress={handleOpenCreateModal}
              activeOpacity={0.85}
            >
              <Plus size={14} color="#fff" />
              <Text style={styles.createGroupBtnText}>Create</Text>
            </TouchableOpacity>
          </View>

          {/* Joined / Suggested sub-tab toggle */}
          <View style={styles.groupsTabRow}>
            <TouchableOpacity
              style={[
                styles.groupsTabBtn,
                groupsTab === 'joined' && styles.groupsTabBtnActive,
              ]}
              onPress={() => setGroupsTab('joined')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.groupsTabText,
                  groupsTab === 'joined' && styles.groupsTabTextActive,
                ]}
              >
                Joined ({myGroups.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.groupsTabBtn,
                groupsTab === 'suggested' && styles.groupsTabBtnActive,
              ]}
              onPress={() => setGroupsTab('suggested')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.groupsTabText,
                  groupsTab === 'suggested' && styles.groupsTabTextActive,
                ]}
              >
                Suggested
              </Text>
            </TouchableOpacity>
          </View>

          {/* Loading / empty / populated states */}
          {groupsTab === 'joined' && loadingMyGroups && (
            <View style={styles.loadingSkeleton}>
              <ActivityIndicator size="small" color={Colors.dark.accent} />
              <Text style={styles.loadingText}>Loading your groups...</Text>
            </View>
          )}
          {groupsTab === 'suggested' && loadingSuggested && (
            <View style={styles.loadingSkeleton}>
              <ActivityIndicator size="small" color={Colors.dark.accent} />
              <Text style={styles.loadingText}>Discovering groups...</Text>
            </View>
          )}

          {!loading && activeGroups.length === 0 && groupsTab === 'joined' && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Your crew awaits — join a fan group!</Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={() => setGroupsTab('suggested')}
              >
                <Text style={styles.emptyCtaText}>Browse Suggested</Text>
              </TouchableOpacity>
            </View>
          )}
          {!loading && activeGroups.length === 0 && groupsTab === 'suggested' && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No public groups yet — be the first to start one!
              </Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={handleOpenCreateModal}
              >
                <Text style={styles.emptyCtaText}>Create a Group</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Horizontal carousel (limit 8) */}
          {activeGroups.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupsCarousel}
            >
              {carouselGroups.map((group) => (
                <View key={group.id} style={styles.groupsCarouselCard}>
                  <GroupCard
                    group={group}
                    showUnread={false}
                    joinable={groupsTab === 'suggested'}
                    isMember={myGroupIds.has(group.id)}
                    onJoinSuccess={handleGroupJoined}
                  />
                </View>
              ))}
            </ScrollView>
          )}

          {activeGroups.length > carouselGroups.length && (
            <TouchableOpacity
              style={styles.seeAllRow}
              onPress={() => setShowAllGroupsModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAllText}>See all →</Text>
            </TouchableOpacity>
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

      {/* See-all Fan Groups modal — full-screen list of the active
          groupsTab (Joined or Suggested). Reuses GroupCard so Join CTA +
          member-count logic behaves identically to the carousel. */}
      <Modal
        visible={showAllGroupsModal}
        animationType="slide"
        onRequestClose={() => setShowAllGroupsModal(false)}
      >
        <SafeAreaView style={styles.fullScreenModal}>
          <View style={styles.fullScreenHeader}>
            <Text style={styles.fullScreenTitle}>
              {groupsTab === 'joined' ? 'My Groups' : 'Suggested Groups'}
            </Text>
            <TouchableOpacity onPress={() => setShowAllGroupsModal(false)}>
              <X size={24} color={Colors.dark.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={activeGroups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.fullScreenList}
            renderItem={({ item }) => (
              <GroupCard
                group={item}
                showUnread={false}
                joinable={groupsTab === 'suggested'}
                isMember={myGroupIds.has(item.id)}
                onJoinSuccess={handleGroupJoined}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No groups to show.</Text>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* Create Group Modal (lifted verbatim from (tabs)/groups.tsx) */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        {/* Android Modal does NOT honor the activity's adjustResize, so we
            need an explicit KeyboardAvoidingView INSIDE the Modal for the
            sheet to push above the soft keyboard. */}
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitleLarge}>Create Fan Group</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                  <X size={24} color={Colors.dark.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>Build your community</Text>

              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Group Name</Text>
                <Text
                  style={[
                    styles.charCount,
                    newGroupName.trim().length > 50 && styles.charCountOver,
                  ]}
                >
                  {newGroupName.trim().length}/50
                </Text>
              </View>
              <TextInput
                style={[
                  styles.fieldInput,
                  newGroupName.trim().length > 0 &&
                    !isGroupNameValid &&
                    styles.fieldInputError,
                ]}
                placeholder="e.g., Lakers Fans NYC"
                placeholderTextColor={Colors.dark.textMuted}
                value={newGroupName}
                onChangeText={setNewGroupName}
                maxLength={50}
              />
              {newGroupName.trim().length > 0 &&
                newGroupName.trim().length < 3 && (
                  <Text style={styles.validationHint}>
                    Name must be at least 3 characters
                  </Text>
                )}

              <Text style={styles.fieldLabel}>Sport</Text>
              <SportPillRow
                pills={SPORT_PILLS}
                activeId={selectedSport}
                onSelect={setSelectedSport}
              />

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Team</Text>
              {selectedTeam ? (
                <View style={styles.selectedTeamRow}>
                  <Text style={styles.selectedTeamText}>
                    {selectedTeam.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedTeam(null);
                      setTeamQuery('');
                    }}
                  >
                    <X size={18} color={Colors.dark.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TextInput
                  style={styles.fieldInput}
                  placeholder="Search for a team..."
                  placeholderTextColor={Colors.dark.textMuted}
                  value={teamQuery}
                  onChangeText={setTeamQuery}
                />
              )}

              {/* Team search results dropdown */}
              {!selectedTeam && teamQuery.length >= 2 && (
                <View style={styles.teamDropdown}>
                  {teamSearchLoading && (
                    <View style={styles.teamDropdownItem}>
                      <ActivityIndicator
                        size="small"
                        color={Colors.dark.accent}
                      />
                    </View>
                  )}
                  {!teamSearchLoading &&
                    teamResults.length === 0 &&
                    teamQuery.length >= 2 && (
                      <View style={styles.teamDropdownItem}>
                        <Text style={styles.teamFallbackText}>
                          No teams found
                        </Text>
                      </View>
                    )}
                  {teamResults.map((team) => (
                    <TouchableOpacity
                      key={team.id}
                      style={styles.teamDropdownItem}
                      onPress={() => {
                        setSelectedTeam({ id: team.id, name: team.name });
                        setTeamQuery('');
                        setTeamResults([]);
                      }}
                    >
                      <Text style={styles.teamDropdownText}>{team.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>City</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g., Dallas, TX"
                placeholderTextColor={Colors.dark.textMuted}
                value={createGroupCity}
                onChangeText={setCreateGroupCity}
              />

              <Text style={styles.fieldLabel}>Visibility</Text>
              <SportPillRow
                pills={VISIBILITY_OPTIONS}
                activeId={selectedVisibility}
                onSelect={setSelectedVisibility}
              />

              {selectedVisibility === 'private' && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.fieldLabel}>Invite Friends</Text>
                  <TouchableOpacity
                    style={styles.inviteButton}
                    onPress={openContactPicker}
                  >
                    <UserPlus size={16} color={Colors.dark.accent} />
                    <Text style={styles.inviteButtonText}>Pick from contacts</Text>
                  </TouchableOpacity>
                  {invitedFriends.length > 0 && (
                    <View style={styles.inviteeList}>
                      {invitedFriends.map((f) => (
                        <View key={f.phone} style={styles.inviteeChip}>
                          <Text style={styles.inviteeName}>{f.name}</Text>
                          <TouchableOpacity onPress={() => removeInvite(f.phone)}>
                            <X size={14} color={Colors.dark.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <View style={[styles.modalActions, { paddingBottom: insets.bottom + 8 }]}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setShowCreateModal(false)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.createButton,
                    !isGroupNameValid && styles.createButtonDisabled,
                  ]}
                  onPress={handleCreateGroup}
                  disabled={!isGroupNameValid || isCreating}
                >
                  {isCreating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.createButtonText}>Create Group</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Contact Picker Modal (private-group invites) */}
      <Modal
        visible={contactPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setContactPickerOpen(false)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitleLarge}>Pick Contacts</Text>
              <TouchableOpacity onPress={() => setContactPickerOpen(false)}>
                <X size={24} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
            {contactsLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color={Colors.dark.accent} />
              </View>
            ) : (
              <FlatList
                data={contactsList}
                keyExtractor={(c) => c.id || c.name || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => handlePickContact(item)}
                  >
                    <View style={styles.contactAvatar}>
                      <Users size={18} color={Colors.dark.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{item.name}</Text>
                      {item.phoneNumbers?.[0]?.number && (
                        <Text style={styles.contactPhone}>
                          {item.phoneNumbers[0].number}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyContactsText}>
                    No contacts with phone numbers found.
                  </Text>
                }
              />
            )}
          </View>
        </View>
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
  loadingSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  emptyState: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyCta: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.dark.accent,
  },
  emptyCtaText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  // Fan Groups section header (title + Create button)
  groupsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
  },
  groupsSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  createGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.dark.accent,
  },
  createGroupBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  // Fan Groups Joined | Suggested sub-tab row
  groupsTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  groupsTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
  },
  groupsTabBtnActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  groupsTabText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  groupsTabTextActive: {
    color: '#fff',
  },
  // Horizontal carousel container + per-card wrapper (so GroupCard's
  // default full-width flex doesn't blow up the horizontal ScrollView).
  groupsCarousel: {
    paddingRight: 16,
    gap: 12,
  },
  groupsCarouselCard: {
    // v9.1 UAT: 280 was too wide on 6" screens — the second tile was
    // clipped to a sliver, making the row look like a size mismatch
    // between "the tile" and "the leftover space". 240 lets a second
    // tile peek clearly on any modern phone width.
    width: 240,
  },
  seeAllRow: {
    alignItems: 'flex-end',
    paddingVertical: 6,
    marginBottom: 12,
  },
  seeAllText: {
    color: Colors.dark.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  // See-all full-screen modal
  fullScreenModal: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  fullScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  fullScreenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  fullScreenList: {
    padding: 16,
  },
  // City-picker modal (existing)
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
  // Create Group modal styles (lifted from (tabs)/groups.tsx)
  modalSheet: {
    backgroundColor: Colors.dark.tabBar,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitleLarge: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 20,
    marginTop: 4,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    marginTop: 8,
  },
  inviteButtonText: {
    color: Colors.dark.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  inviteeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  inviteeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.dark.surfaceLight,
  },
  inviteeName: {
    color: Colors.dark.text,
    fontSize: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactName: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '600',
  },
  contactPhone: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  emptyContactsText: {
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    padding: 40,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 6,
    marginTop: 12,
  },
  charCount: {
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  charCountOver: {
    color: '#ff4444',
  },
  fieldInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    color: Colors.dark.text,
    fontSize: 15,
  },
  fieldInputError: {
    borderColor: '#ff4444',
  },
  validationHint: {
    fontSize: 11,
    color: '#ff4444',
    marginTop: 4,
  },
  selectedTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  selectedTeamText: {
    fontSize: 15,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  teamDropdown: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginTop: 4,
    overflow: 'hidden',
  },
  teamDropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  teamDropdownText: {
    fontSize: 14,
    color: Colors.dark.text,
  },
  teamFallbackText: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    fontStyle: 'italic',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '700',
  },
  createButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
