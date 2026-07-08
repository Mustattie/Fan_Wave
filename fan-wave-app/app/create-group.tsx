import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Users } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import { isExpoGo } from '@/lib/entitlements';
import { SportPillRow } from '@/components/SportPill';
import { SPORTS, SPORT_BY_ID, type SportId } from '@/constants/Sports';

// v9.0: universal user-created-groups key. Renamed from wc_created_groups —
// old Expo Go previews under the WC key are intentionally dropped (test-mode
// artifacts only, no real data lost).
const USER_CREATED_GROUPS_KEY = 'user_created_groups';

const C = Colors.dark;
const GREEN = C.accentGreen;

// Sport pills for the SportPillRow chip picker. Uses SPORTS from
// constants/Sports.ts as the source of truth; label combines name + emoji
// to match the (tabs)/groups.tsx create-modal pattern.
const SPORT_PILLS = SPORTS.map((s) => ({
  id: s.id,
  label: `${s.name} ${s.icon}`,
}));

export default function CreateGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sportId: string }>();
  const initialSportId =
    params.sportId && SPORT_BY_ID[params.sportId]
      ? (params.sportId as SportId)
      : null;

  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSportId, setSelectedSportId] = useState<SportId | null>(
    initialSportId,
  );
  const [isCreating, setIsCreating] = useState(false);

  const getGroupHeaderTitle = () => 'Create Fan Group';

  const getGroupIcon = () => {
    if (!selectedSportId) return '👥';
    return SPORT_BY_ID[selectedSportId]?.icon ?? '👥';
  };

  const isValid = groupName.trim().length >= 3;

  const saveGroupLocally = async (group: any) => {
    try {
      const raw = await AsyncStorage.getItem(USER_CREATED_GROUPS_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      existing.push(group);
      await AsyncStorage.setItem(
        USER_CREATED_GROUPS_KEY,
        JSON.stringify(existing),
      );
    } catch {
      // Silently fail
    }
  };

  const handleCreate = async () => {
    if (!isValid) return;
    setIsCreating(true);

    // v8.5 P0 (preserved for v9.0): read user's home city as a fallback so
    // user-created groups are filterable under the Groups tab "By City"
    // filter even when the user didn't pick a city here.
    let homeCityFallback: string | null = null;
    try {
      homeCityFallback = await AsyncStorage.getItem('user_city');
    } catch {
      // ignore — fallback stays null
    }
    const cityForGroup = homeCityFallback
      ? homeCityFallback.split(',')[0]?.trim() ?? null
      : null;

    const sportName = selectedSportId
      ? SPORT_BY_ID[selectedSportId]?.name ?? null
      : null;

    // v9.0: tags derive from sport + home city (nullable). No hardcoded
    // WC/Soccer Cup tag anymore.
    const tags: string[] = [];
    if (sportName) tags.push(sportName);
    if (cityForGroup) tags.push(cityForGroup);

    const groupIcon = getGroupIcon();

    const groupData = {
      id: `new-${Date.now()}`,
      name: groupName.trim(),
      description:
        description.trim() ||
        (sportName ? `${sportName} Fan Group` : 'Fan Group'),
      icon: groupIcon,
      memberCount: 1,
      onlineCount: 1,
      tags,
      isPublic: true,
    };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please sign in to create a group.');
        setIsCreating(false);
        return;
      }

      // v9.0: universal group_type='sports' (already defined in migration 002).
      // sport_id lookup mirrors the (tabs)/groups.tsx create-modal — we resolve
      // the sport row so RLS/discovery filters keyed on sport_id keep working.
      let sportRowId: string | null = null;
      if (sportName) {
        const { data: sportRow } = await supabase
          .from('sports')
          .select('id')
          .ilike('name', sportName)
          .maybeSingle();
        sportRowId = sportRow?.id ?? null;
      }

      const { data, error } = await supabase
        .from('chat_rooms')
        .insert({
          name: groupData.name,
          description: groupData.description,
          group_type: 'sports',
          sport_id: sportRowId,
          visibility: 'public',
          avatar_url: groupData.icon,
          tags,
          // v8.5 P0 (preserved): home_city fallback so user-created groups
          // are discoverable under the By City filter.
          city: cityForGroup,
          owner_id: user.id,
          member_count: 1,
        })
        .select()
        .single();

      if (error) {
        // In Expo Go the chat_rooms RLS gate (migration 053 freemium quota)
        // rejects inserts once the user is past the free tier. Surface a
        // friendly test-mode success so the user can walk the full create
        // flow without hitting the cryptic 42501 dialog. Local groups list
        // still picks up the group via AsyncStorage so the UX preview is
        // complete.
        const isRls =
          (error as any)?.code === '42501' ||
          /row-level security/i.test(error.message ?? '');
        if (isRls && isExpoGo()) {
          await saveGroupLocally(groupData);
          setIsCreating(false);
          Alert.alert(
            'Test mode (Expo Go)',
            'Form looks good! In a production build with a Fan Sphere Premium subscription this would have created the group on the server. We saved a local preview so you can still see it on the Fan Groups list.',
            [
              { text: 'View Group', onPress: () => router.replace(`/fan-group/${groupData.id}` as any) },
              { text: 'Done', onPress: () => router.back() },
            ],
          );
          return;
        }
        Alert.alert('Error', `Could not create group: ${error.message}`);
        setIsCreating(false);
        return;
      }

      if (data) {
        groupData.id = data.id;

        // v8.5 P0 (preserved): insert the owner as a chat_room_members row
        // so match_moments / messages RLS gates (which require
        // is_chat_room_member, not just owner_id) accept their inserts.
        // Swallow duplicate-key errors so a race or retry doesn't surface
        // as failure.
        const { error: memberError } = await supabase
          .from('chat_room_members')
          .insert({
            chat_room_id: data.id,
            user_id: user.id,
            role: 'owner',
          });
        if (memberError) {
          const mCode = (memberError as any)?.code;
          const mMsg = (memberError.message ?? '').toLowerCase();
          const isDup = mCode === '23505' || mMsg.includes('duplicate');
          if (!isDup) {
            reportError(memberError, {
              source: 'create-group:ownerMember',
              roomId: data.id,
            });
          }
        }
      }
    } catch {
      Alert.alert('Error', 'Could not create group. Please check your connection.');
      setIsCreating(false);
      return;
    }

    await saveGroupLocally(groupData);

    setIsCreating(false);
    Alert.alert('Group Created!', `"${groupName}" has been created.`, [
      { text: 'View Group', onPress: () => router.replace(`/fan-group/${groupData.id}` as any) },
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{getGroupHeaderTitle()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Group icon banner — derived from selected sport */}
        <View style={styles.templateBanner}>
          <Text style={styles.templateIcon}>{getGroupIcon()}</Text>
          <Text style={styles.templateLabel}>{getGroupHeaderTitle()}</Text>
        </View>

        {/* Sport picker chip row */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Sport</Text>
          <SportPillRow
            pills={SPORT_PILLS}
            activeId={selectedSportId ?? ''}
            onSelect={(id) => setSelectedSportId(id as SportId)}
          />
        </View>

        {/* Group Name */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group Name</Text>
          <TextInput
            style={styles.input}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Enter group name..."
            placeholderTextColor={C.textMuted}
            maxLength={50}
          />
          <Text style={styles.charCount}>{groupName.length}/50</Text>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this group about?"
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={styles.charCount}>{description.length}/200</Text>
        </View>
      </ScrollView>

      {/* Create Button — paddingBottom uses safe-area inset so the green
          button sits above the Android nav bar / iPhone home indicator. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.createButton, !isValid && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={!isValid || isCreating}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Users size={20} color="#fff" />
              <Text style={styles.createButtonText}>Create Group</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 160,
  },
  templateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: `${GREEN}15`,
    borderWidth: 1,
    borderColor: `${GREEN}44`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  templateIcon: {
    fontSize: 32,
  },
  templateLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: GREEN,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: C.text,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    // paddingBottom set dynamically via useSafeAreaInsets().bottom in JSX
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 14,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
