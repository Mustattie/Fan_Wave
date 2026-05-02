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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, Plus, X, Users, UserPlus } from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import { Colors } from '@/constants/Colors';
import { GroupCard } from '@/components/GroupCard';
import { SectionHeader } from '@/components/SectionHeader';
import { SportPillRow } from '@/components/SportPill';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mapChatRoomToDisplay, type ChatRoomDisplay } from '@/lib/mappers';

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
  const [isCreating, setIsCreating] = useState(false);

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

  // City state
  const [city, setCity] = useState('');

  // Load user city from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem('user_city').then((stored) => {
      setCity(stored || 'Chicago');
    });
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
          setLoadingMyGroups(false);
          return;
        }

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

  // Fetch suggested groups from Supabase on mount
  useEffect(() => {
    const fetchSuggested = async () => {
      setLoadingSuggested(true);
      try {
        const { data, error } = await supabase.rpc('browse_public_groups', {
          p_city: city,
        });

        if (error) throw error;

        if (data && data.length > 0) {
          const memberIds = new Set(myGroups.map((g) => g.id));
          const filtered = data.filter((g: any) => !memberIds.has(g.id));
          setSuggestedGroups(filtered);
        } else {
          setSuggestedGroups([]);
        }
      } catch {
        setSuggestedGroups([]);
      } finally {
        setLoadingSuggested(false);
      }
    };

    if (city) fetchSuggested();
  }, [city, myGroups]);

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

  const handleJoin = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (joinedIds.has(id)) {
        await supabase
          .from('chat_room_members')
          .delete()
          .eq('chat_room_id', id)
          .eq('user_id', user.id);
        setJoinedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        await supabase.from('chat_room_members').insert({
          chat_room_id: id,
          user_id: user.id,
          role: 'member',
        });
        setJoinedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    } catch {
      Alert.alert('Error', 'Could not update group membership.');
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
      // SMS composer so the user reviews and sends. No DB invite table yet.
      if (selectedVisibility === 'private' && invitedFriends.length > 0) {
        const inviteLink = `https://fanwave.app/group/${room.id}`;
        const body = encodeURIComponent(
          `Join my Fan Wave group "${newGroupName.trim()}": ${inviteLink}`,
        );
        // Android uses ? for body; iOS tolerates it. Multi-recipient via
        // comma-separated numbers works on both.
        const numbers = invitedFriends.map((f) => f.phone.replace(/\s+/g, '')).join(',');
        const smsUrl = `sms:${numbers}?body=${body}`;
        try {
          const supported = await Linking.canOpenURL(smsUrl);
          if (supported) await Linking.openURL(smsUrl);
        } catch {
          // SMS composer not available — silently skip.
        }
      }
    } catch {
      Alert.alert('Error', 'Could not create group. Please try again.');
    } finally {
      setIsCreating(false);
      setNewGroupName('');
      setTeamQuery('');
      setSelectedTeam(null);
      setTeamResults([]);
      setInvitedFriends([]);
      setShowCreateModal(false);
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
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Contacts permission denied',
        'Enable Contacts access in Settings to invite friends.',
      );
      return;
    }
    setContactPickerOpen(true);
    setContactsLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const withPhones = data
        .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0 && c.name)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setContactsList(withPhones);
    } catch {
      Alert.alert('Could not load contacts', 'Please try again.');
      setContactPickerOpen(false);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const addContactToInvites = useCallback((name: string, phone: string) => {
    const cleaned = phone.replace(/\s+/g, '');
    setInvitedFriends((prev) => {
      if (prev.some((f) => f.phone.replace(/\s+/g, '') === cleaned)) return prev;
      return [...prev, { name, phone }];
    });
  }, []);

  const handlePickContact = useCallback(
    (contact: Contacts.Contact) => {
      const phones = contact.phoneNumbers || [];
      const name = contact.name || 'Unknown';
      if (phones.length === 1) {
        addContactToInvites(name, phones[0].number || '');
        setContactPickerOpen(false);
        return;
      }
      Alert.alert(
        `Pick a number for ${name}`,
        undefined,
        [
          ...phones.map((p) => ({
            text: `${p.label ? `${p.label}: ` : ''}${p.number}`,
            onPress: () => {
              addContactToInvites(name, p.number || '');
              setContactPickerOpen(false);
            },
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
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
          <Text style={styles.title}>My Groups</Text>
          <Text style={styles.subtitle}>
            {myGroups.length} groups
          </Text>
        </View>
        <TouchableOpacity style={styles.headerAction} onPress={handleOpenCreateModal}>
          <Plus size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Search size={18} color={Colors.dark.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search my groups..."
          placeholderTextColor={Colors.dark.textMuted}
        />
      </View>

      <FlatList
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        data={suggestedGroups}
        keyExtractor={(item: any) => item.id}
        ListHeaderComponent={
          <>
            {/* Loading skeleton for my groups */}
            {loadingMyGroups && (
              <View style={styles.loadingSkeleton}>
                <ActivityIndicator size="small" color={Colors.dark.accent} />
                <Text style={styles.loadingText}>Loading your groups...</Text>
              </View>
            )}

            {!loadingMyGroups && myGroups.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Your crew awaits — join a fan group!</Text>
              </View>
            )}

            {!loadingMyGroups &&
              myGroups.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}

            <SectionHeader title="Suggested Groups" />

            {/* Loading skeleton for suggested groups */}
            {loadingSuggested && (
              <View style={styles.loadingSkeleton}>
                <ActivityIndicator size="small" color={Colors.dark.accent} />
                <Text style={styles.loadingText}>
                  Discovering groups near you...
                </Text>
              </View>
            )}

            {!loadingSuggested && suggestedGroups.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No groups in your area yet — start one!</Text>
              </View>
            )}
          </>
        }
        renderItem={({ item: group }: { item: any }) => (
          <View style={styles.suggestedCard}>
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
                  {joinedIds.has(group.id)
                    ? `${(group.memberCount || group.member_count || 0) + 1} members · Joined`
                    : `${group.memberCount || group.member_count || 0} members`}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.joinButton,
                  joinedIds.has(group.id) && styles.joinedButton,
                ]}
                onPress={() => handleJoin(group.id)}
              >
                <Text
                  style={[
                    styles.joinButtonText,
                    joinedIds.has(group.id) && styles.joinedButtonText,
                  ]}
                >
                  {joinedIds.has(group.id) ? '✓ Joined' : 'Join'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListFooterComponent={<View style={styles.spacer} />}
      />

      {/* Create Group Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            keyboardShouldPersistTaps="handled"
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
                placeholder="Your city"
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

              <View style={styles.modalActions}>
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
        </View>
      </Modal>

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
    maxHeight: '85%',
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
});
