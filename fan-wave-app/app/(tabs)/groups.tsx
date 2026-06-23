import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, Plus, X, Users, UserPlus } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import {
  loadContactsWithPhones,
  pickPhoneForContact,
  openSmsInvite,
  buildGroupInviteBody,
} from '@/lib/inviteContacts';
import { Colors } from '@/constants/Colors';
import { GroupCard } from '@/components/GroupCard';
import { SectionHeader } from '@/components/SectionHeader';
import { SportPillRow } from '@/components/SportPill';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mapChatRoomToDisplay, type ChatRoomDisplay } from '@/lib/mappers';
import { PremiumPaywall } from '@/components/paywall/PremiumPaywall';

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

export default function GroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedSport, setSelectedSport] = useState('nfl');
  const [selectedVisibility, setSelectedVisibility] = useState('public');

  // Private-group invite flow (reuses the watch-party contact-picker pattern)
  const [invitedFriends, setInvitedFriends] = useState<{ name: string; phone: string }[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.ExistingContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  // Supabase-backed state
  const [myGroups, setMyGroups] = useState<ChatRoomDisplay[]>([]);
  const [suggestedGroups, setSuggestedGroups] = useState<any[]>([]);
  const [loadingMyGroups, setLoadingMyGroups] = useState(true);
  const [loadingSuggested, setLoadingSuggested] = useState(true);
  // v8.7+ P0: top-level segmented toggle so the Discover section + Join
  // CTAs are reachable in one tap. Previously a user with N joined groups
  // had to scroll past N cards to reach the Discover header — at N=11
  // the user reported "groups have no Join button" because Discover was
  // effectively invisible.
  const [topTab, setTopTab] = useState<'joined' | 'discover'>('joined');
  // Discover sub-tabs (Issue #6 v8.2): replicate Soccer Cup → Fan Groups
  // pattern (All / By City / By Sport) so the green Join CTA is reachable
  // on the main Groups tab. Default to "All" so users always see *something*
  // when their city has no groups yet.
  const [discoverTab, setDiscoverTab] = useState<'all' | 'city' | 'sport'>('all');
  const [discoverSport, setDiscoverSport] = useState<string>('nfl');
  const [isCreating, setIsCreating] = useState(false);
  const [showPremiumPaywall, setShowPremiumPaywall] = useState(false);
  // Current auth user id — needed to hide the Join CTA on groups the user
  // already owns (Issue #6 v8.1).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Track in-flight joins so we can disable the button & avoid double-inserts.
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());

  // Team search state
  const [teamQuery, setTeamQuery] = useState('');
  const [teamResults, setTeamResults] = useState<
    { id: string; name: string; logo_url?: string }[]
  >([]);
  const [selectedTeam, setSelectedTeam] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [teamSearchLoading, setTeamSearchLoading] = useState(false);

  // City state — prefilled from users.home_city (fallback to AsyncStorage
  // cache for offline UX). Never hardcode a city; an empty value lets the
  // placeholder ("e.g., Dallas, TX") guide the user.
  const [city, setCity] = useState('');

  // Load user home_city from the users table on mount. Issue #8 v8.1:
  // the previous default of "Chicago" appeared for every user regardless of
  // their actual profile city, which broke the Suggested-Groups discovery
  // query for non-Chicago users.
  useEffect(() => {
    const loadCity = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('users')
          .select('home_city')
          .eq('auth_id', user.id)
          .single();

        const homeCity = (data?.home_city ?? '').toString().trim();
        if (homeCity) {
          setCity(homeCity);
          // Cache for offline / next launch
          AsyncStorage.setItem('user_city', homeCity).catch(() => {});
        } else {
          // Profile city not set — try cached value, otherwise leave blank
          const stored = await AsyncStorage.getItem('user_city');
          if (stored) setCity(stored);
        }
      } catch {
        // Network error — fall back to cached city, never to "Chicago".
        const stored = await AsyncStorage.getItem('user_city');
        if (stored) setCity(stored);
      }
    };
    loadCity();
  }, []);

  // Fetch my groups from Supabase on mount
  useEffect(() => {
    const fetchMyGroups = async () => {
      setLoadingMyGroups(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setMyGroups([]);
          setCurrentUserId(null);
          setLoadingMyGroups(false);
          return;
        }
        setCurrentUserId(user.id);

        const { data, error } = await supabase
          .from('chat_room_members')
          .select('chat_rooms(*)')
          .eq('user_id', user.id);

        if (error) throw error;

        if (data && data.length > 0) {
          const groups = data
            .map((row: any) => row.chat_rooms)
            .filter(Boolean)
            .map(mapChatRoomToDisplay);
          setMyGroups(groups);
        } else {
          setMyGroups([]);
        }
      } catch {
        setMyGroups([]);
      } finally {
        setLoadingMyGroups(false);
      }
    };

    fetchMyGroups();
  }, []);

  // Discover-section fetch (Issue #6 v8.2). Queries `chat_rooms` directly
  // rather than the browse_public_groups RPC so we can express the
  // All / By City / By Sport filters in a single composable query and so
  // a missing/buggy RPC can't silently zero out the list (which is what
  // hid the Join button in v8.1). RLS migration 002 already allows
  // SELECT on visibility='public' rows for any authenticated user, so
  // this is safe from the client.
  useEffect(() => {
    const fetchDiscover = async () => {
      setLoadingSuggested(true);
      try {
        // Need an authed user to compute "exclude my groups"
        const {
          data: { user },
        } = await supabase.auth.getUser();

        let query = supabase
          .from('chat_rooms')
          .select('*')
          .eq('visibility', 'public')
          .order('member_count', { ascending: false })
          .limit(30);

        if (discoverTab === 'city') {
          if (!city) {
            // Show empty state below — caller knows by discoverTab + !city
            setSuggestedGroups([]);
            setLoadingSuggested(false);
            return;
          }
          query = query.ilike('city', city);
        } else if (discoverTab === 'sport') {
          // Resolve sport_id from the selected pill so we can filter by it
          const sportNameMap: Record<string, string> = {
            nfl: 'NFL',
            nba: 'NBA',
            mlb: 'MLB',
            soccer: 'Soccer',
          };
          const sportName = sportNameMap[discoverSport];
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

        const { data, error } = await query;
        if (error) throw error;

        const memberIds = new Set(myGroups.map((g) => g.id));
        const filtered = (data || []).filter(
          (g: any) =>
            !memberIds.has(g.id) && (!user || g.owner_id !== user.id),
        );
        setSuggestedGroups(filtered);
      } catch {
        setSuggestedGroups([]);
      } finally {
        setLoadingSuggested(false);
      }
    };

    fetchDiscover();
  }, [discoverTab, discoverSport, city, myGroups]);

  // Team search with debounce
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

  // Issue #6 v8.1: Suggested-group Join CTA.
  // - Insert MUST include user_id explicitly to satisfy migration 053 RLS
  //   (user_id = auth.uid()). Same fix applied to WCFanGroups in v8.1.
  // - On success, move the group from Suggested → My Groups locally so the
  //   UI updates without a refetch round-trip.
  // - On 42501 (RLS), the Premium gate is active — surface the paywall.
  const handleJoin = async (id: string) => {
    if (joiningIds.has(id) || joinedIds.has(id)) return;

    setJoiningIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to join a group.');
        return;
      }

      const { error } = await supabase.from('chat_room_members').insert({
        chat_room_id: id,
        user_id: user.id,
        role: 'member',
      });

      if (error) {
        const code: string | undefined = (error as any)?.code;
        const msg: string = (error.message ?? '').toLowerCase();
        const isRlsBlock =
          code === '42501' ||
          msg.includes('row-level security') ||
          msg.includes('violates row-level security policy');
        if (isRlsBlock) {
          setShowPremiumPaywall(true);
        } else {
          Alert.alert(
            'Could not join',
            'Could not join — try again or contact support.',
          );
        }
        return;
      }

      // Optimistic local move: mark joined, then move card from Suggested
      // → My Groups so the user sees the result immediately.
      setJoinedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setSuggestedGroups((prev) => {
        const joined = prev.find((g: any) => g.id === id);
        if (joined) {
          setMyGroups((mg) => {
            if (mg.some((g) => g.id === id)) return mg;
            return [mapChatRoomToDisplay(joined), ...mg];
          });
        }
        return prev.filter((g: any) => g.id !== id);
      });
    } catch {
      Alert.alert(
        'Could not join',
        'Could not join — try again or contact support.',
      );
    } finally {
      setJoiningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const isGroupNameValid =
    newGroupName.trim().length >= 3 && newGroupName.trim().length <= 50;

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
          city: city,
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

      // Dispatch SMS invites for private groups — uses the device's native
      // SMS composer so the user reviews and sends. Centralised in
      // lib/inviteContacts so the fan-group detail-page invite reuses
      // the same SMS deep-link logic.
      if (selectedVisibility === 'private' && invitedFriends.length > 0) {
        await openSmsInvite(
          invitedFriends,
          buildGroupInviteBody({ id: room.id, name: newGroupName.trim() }),
        );
      }
      // Success path: clear inputs + close the modal.
      setNewGroupName('');
      setTeamQuery('');
      setSelectedTeam(null);
      setTeamResults([]);
      setInvitedFriends([]);
      setShowCreateModal(false);
    } catch (e: any) {
      // 42501 = row-level security violation. With migration 053, this means
      // the user is past their free-tier quota (already owns ≥1 group) and
      // doesn't have Premium. Show the upgrade modal and DON'T wipe the form
      // — the user can dismiss the paywall and try again with their inputs
      // preserved.
      const code: string | undefined = e?.code;
      const msg: string = (e?.message ?? '').toLowerCase();
      const isRlsBlock =
        code === '42501' ||
        msg.includes('row-level security') ||
        msg.includes('violates row-level security policy');
      if (isRlsBlock) {
        setShowCreateModal(false);
        setShowPremiumPaywall(true);
      } else {
        // Transient error (network blip, etc.) — keep the modal open with
        // their typed inputs so they can retry without re-entering anything.
        Alert.alert('Error', 'Could not create group. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenCreateModal = () => {
    setNewGroupName('');
    setTeamQuery('');
    setSelectedTeam(null);
    setTeamResults([]);
    setInvitedFriends([]);
    setShowCreateModal(true);
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {topTab === 'joined' ? 'My Groups' : 'Discover Groups'}
          </Text>
          <Text style={styles.subtitle}>
            {topTab === 'joined'
              ? `${myGroups.length} groups`
              : 'Find fan groups to join'}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerAction} onPress={handleOpenCreateModal}>
          <Plus size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* v8.7+ Joined / Discover segmented toggle. Lets a user with many
          joined groups reach the public-group Discover list in one tap
          instead of scrolling past every card. */}
      <View style={styles.topTabRow}>
        <TouchableOpacity
          style={[styles.topTabBtn, topTab === 'joined' && styles.topTabBtnActive]}
          onPress={() => setTopTab('joined')}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.topTabText,
              topTab === 'joined' && styles.topTabTextActive,
            ]}
          >
            Joined
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.topTabBtn, topTab === 'discover' && styles.topTabBtnActive]}
          onPress={() => setTopTab('discover')}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.topTabText,
              topTab === 'discover' && styles.topTabTextActive,
            ]}
          >
            Discover
          </Text>
        </TouchableOpacity>
      </View>

      {topTab === 'joined' && (
        <View style={styles.searchBar}>
          <Search size={18} color={Colors.dark.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search my groups..."
            placeholderTextColor={Colors.dark.textMuted}
          />
        </View>
      )}

      <FlatList
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        data={topTab === 'discover' ? suggestedGroups : []}
        keyExtractor={(item: any) => item.id}
        ListHeaderComponent={
          <>
            {/* My Groups view — only shown when "Joined" tab is active. */}
            {topTab === 'joined' && loadingMyGroups && (
              <View style={styles.loadingSkeleton}>
                <ActivityIndicator size="small" color={Colors.dark.accent} />
                <Text style={styles.loadingText}>Loading your groups...</Text>
              </View>
            )}

            {topTab === 'joined' && !loadingMyGroups && myGroups.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Your crew awaits — join a fan group!</Text>
                <TouchableOpacity
                  style={styles.emptyCta}
                  onPress={() => setTopTab('discover')}
                >
                  <Text style={styles.emptyCtaText}>Browse Groups</Text>
                </TouchableOpacity>
              </View>
            )}

            {topTab === 'joined' &&
              !loadingMyGroups &&
              myGroups.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}

            {/* Discover view — sub-tab pills + suggested groups with Join CTAs.
                Shown only when "Discover" tab is active. */}
            {topTab === 'discover' && (
              <>
                <SectionHeader title="Discover" />

                {/* Discover sub-tab pills — All / By City / By Sport. */}
                <View style={styles.discoverPillRow}>
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'city', label: 'By City' },
                      { id: 'sport', label: 'By Sport' },
                    ] as const
                  ).map((tab) => (
                    <TouchableOpacity
                      key={tab.id}
                      style={[
                        styles.discoverPill,
                        discoverTab === tab.id && styles.discoverPillActive,
                      ]}
                      onPress={() => setDiscoverTab(tab.id)}
                    >
                      <Text
                        style={[
                          styles.discoverPillText,
                          discoverTab === tab.id && styles.discoverPillTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Sport sub-pills appear only when "By Sport" is active. */}
                {discoverTab === 'sport' && (
                  <View style={styles.discoverSportRow}>
                    {SPORT_PILLS.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[
                          styles.discoverSportPill,
                          discoverSport === s.id && styles.discoverSportPillActive,
                        ]}
                        onPress={() => setDiscoverSport(s.id)}
                      >
                        <Text
                          style={[
                            styles.discoverSportPillText,
                            discoverSport === s.id &&
                              styles.discoverSportPillTextActive,
                          ]}
                        >
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {loadingSuggested && (
                  <View style={styles.loadingSkeleton}>
                    <ActivityIndicator size="small" color={Colors.dark.accent} />
                    <Text style={styles.loadingText}>
                      {discoverTab === 'city'
                        ? `Discovering groups in ${city || 'your city'}...`
                        : 'Discovering groups...'}
                    </Text>
                  </View>
                )}

                {!loadingSuggested &&
                  suggestedGroups.length === 0 &&
                  discoverTab === 'city' &&
                  !city && (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>
                        Set your home city in Profile to discover local fan groups.
                      </Text>
                    </View>
                  )}

                {!loadingSuggested &&
                  suggestedGroups.length === 0 &&
                  discoverTab === 'city' &&
                  !!city && (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>
                        No public groups in {city} yet — be the first, create one!
                      </Text>
                      <TouchableOpacity
                        style={styles.emptyCta}
                        onPress={handleOpenCreateModal}
                      >
                        <Text style={styles.emptyCtaText}>Create a Group</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                {!loadingSuggested &&
                  suggestedGroups.length === 0 &&
                  discoverTab === 'sport' && (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>
                        No public groups for this sport yet — start one!
                      </Text>
                      <TouchableOpacity
                        style={styles.emptyCta}
                        onPress={handleOpenCreateModal}
                      >
                        <Text style={styles.emptyCtaText}>Create a Group</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                {!loadingSuggested &&
                  suggestedGroups.length === 0 &&
                  discoverTab === 'all' && (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>
                        No public groups yet — be the first to start one!
                      </Text>
                    </View>
                  )}
              </>
            )}
          </>
        }
        renderItem={({ item: group }: { item: any }) => {
          // Wrap whole row in TouchableOpacity so tapping the card navigates
          // to the fan-group detail screen. The nested Join button captures
          // its own taps (RN bubbles touch events to the innermost
          // responder), so pressing Join doesn't also fire navigation.
          //
          // Issue #6 v8.1: Show Join only if the user is NOT the owner and
          // NOT already a member. myGroups membership is the source of truth
          // for the current session; joinedIds tracks just-joined items
          // before they migrate into myGroups via the optimistic update.
          const ownerId: string | undefined = group.owner_id;
          const isOwner = !!(currentUserId && ownerId === currentUserId);
          const isMember =
            joinedIds.has(group.id) ||
            myGroups.some((g) => g.id === group.id);
          const isJoining = joiningIds.has(group.id);

          return (
            <TouchableOpacity
              style={styles.suggestedCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/fan-group/${group.id}`)}
            >
              <View style={styles.suggestedHeader}>
                <View
                  style={[
                    styles.suggestedIcon,
                    { backgroundColor: group.iconBg || group.icon_bg || Colors.dark.accent + '33' },
                  ]}
                >
                  <Text style={styles.suggestedIconText}>
                    {group.icon || '🏟️'}
                  </Text>
                </View>
                <View style={styles.suggestedInfo}>
                  <Text style={styles.suggestedName}>{group.name}</Text>
                  <Text style={styles.suggestedMembers}>
                    {isMember
                      ? `${(group.memberCount || group.member_count || 0) + 1} members · Joined`
                      : `${group.memberCount || group.member_count || 0} members`}
                  </Text>
                </View>
                {!isOwner && (
                  <TouchableOpacity
                    style={[
                      styles.joinButton,
                      isMember && styles.joinedButton,
                    ]}
                    onPress={() => handleJoin(group.id)}
                    disabled={isMember || isJoining}
                  >
                    {isJoining ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text
                        style={[
                          styles.joinButtonText,
                          isMember && styles.joinedButtonText,
                        ]}
                      >
                        {isMember ? '✓ Joined' : 'Join'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={<View style={styles.spacer} />}
      />

      {/* Create Group Modal */}
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
                <Text style={styles.modalTitle}>Create Fan Group</Text>
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
                value={city}
                onChangeText={setCity}
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

      <PremiumPaywall
        visible={showPremiumPaywall}
        onClose={() => setShowPremiumPaywall(false)}
      />

      {/* Contact Picker Modal */}
      <Modal
        visible={contactPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setContactPickerOpen(false)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick Contacts</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 4,
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
  scrollContent: {
    flex: 1,
    paddingHorizontal: 16,
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
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  suggestedCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  suggestedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggestedIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedIconText: {
    fontSize: 22,
  },
  suggestedInfo: {
    flex: 1,
  },
  suggestedName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  suggestedMembers: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  joinButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.dark.accent,
  },
  joinedButton: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1.5,
    borderColor: Colors.dark.success,
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  joinedButtonText: {
    color: Colors.dark.success,
  },
  spacer: {
    height: 80,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalSheet: {
    backgroundColor: Colors.dark.tabBar,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    // No maxHeight cap — capping clipped the bottom of the sheet when the
    // user picked Private (which adds an Invite Friends section). The
    // outer ScrollView + flexGrow:1+justifyContent:'flex-end' wrapping
    // gives natural scroll behaviour when content exceeds the viewport.
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
  modalTitle: {
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
  // v8.7+ top-level Joined / Discover segmented toggle
  topTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  topTabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
  },
  topTabBtnActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  topTabText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  topTabTextActive: {
    color: '#fff',
  },

  // Discover sub-tabs (Issue #6 v8.2)
  discoverPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  discoverPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  discoverPillActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  discoverPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  discoverPillTextActive: {
    color: '#fff',
  },
  discoverSportRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  discoverSportPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  discoverSportPillActive: {
    backgroundColor: Colors.dark.accent + '33',
    borderColor: Colors.dark.accent,
  },
  discoverSportPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  discoverSportPillTextActive: {
    color: Colors.dark.accent,
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
});
