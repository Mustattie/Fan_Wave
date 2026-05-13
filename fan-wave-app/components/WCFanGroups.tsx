import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Search, Share2 } from 'lucide-react-native';
import { shareGroup } from '@/lib/sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from '@/lib/errorReporting';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

const WC_CREATED_GROUPS_KEY = 'wc_created_groups';

// ── Types ──────────────────────────────────────────────────

interface WCFanGroupItem {
  id: string;
  name: string;
  icon: string;
  memberCount: number;
  onlineCount: number;
  description: string;
  tags: string[];
  isPublic: boolean;
}

interface GroupTemplate {
  id: string;
  icon: string;
  label: string;
  description: string;
}

// ── Filter pills ───────────────────────────────────────────

const FILTER_PILLS = ['All Groups', 'By Country', 'By City', 'Travel Fans'];

// ── Group templates ────────────────────────────────────────

const GROUP_TEMPLATES: GroupTemplate[] = [
  { id: 'tpl-team', icon: '🏴', label: 'Team Fans', description: '[Country] Fans' },
  { id: 'tpl-match', icon: '⚽', label: 'Match Watch', description: '[Team A] vs [Team B] Watch' },
  { id: 'tpl-travel', icon: '✈️', label: 'Travel Fans', description: 'Traveling to [City] for WC' },
  { id: 'tpl-city', icon: '🏙️', label: 'City Hub', description: '[City] World Cup Hub' },
];

// ── Component ──────────────────────────────────────────────

export default function WCFanGroups() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All Groups');
  const [groups, setGroups] = useState<WCFanGroupItem[]>([]);
  const [joinedMap, setJoinedMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // ── Load groups (Supabase + local) ─────────────────────

  useFocusEffect(
    useCallback(() => {
      fetchGroups();
    }, [])
  );

  const loadLocalGroups = async (): Promise<WCFanGroupItem[]> => {
    try {
      const raw = await AsyncStorage.getItem(WC_CREATED_GROUPS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      reportError(e, { source: 'WCFanGroups:loadLocalGroups' });
    }
    return [];
  };

  const fetchGroups = async () => {
    setLoading(true);

    const localGroups = await loadLocalGroups();

    try {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select('*')
        .eq('group_type', 'worldcup');

      if (!error && data) {
        const mapped: WCFanGroupItem[] = data.map((g: any) => ({
          id: g.id,
          name: g.name || 'WC Group',
          icon: g.icon || '⚽',
          memberCount: g.member_count || 0,
          onlineCount: g.online_count || 0,
          description: g.description || '',
          tags: g.tags || ['World Cup'],
          isPublic: g.is_public !== false,
        }));
        // Deduplicate: only include local groups not already in Supabase results
        const supabaseIds = new Set(mapped.map((g) => g.id));
        const uniqueLocal = localGroups.filter((g) => !supabaseIds.has(g.id));
        setGroups([...uniqueLocal, ...mapped]);
      } else {
        setGroups(localGroups);
      }
    } catch {
      setGroups(localGroups);
    } finally {
      setLoading(false);
    }
  };

  // ── Filtering ──────────────────────────────────────────

  const filteredGroups = groups.filter((g) => {
    const matchesSearch =
      !searchQuery ||
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.description.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeFilter === 'All Groups') return matchesSearch;
    if (activeFilter === 'By Country') {
      return matchesSearch && g.tags.some((t) => !['World Cup', 'Travel', 'Hub'].includes(t));
    }
    if (activeFilter === 'By City') {
      return matchesSearch && g.tags.some((t) => ['New York', 'Dallas', 'Los Angeles', 'Miami', 'Chicago', 'Houston', 'Toronto', 'Mexico City'].includes(t));
    }
    if (activeFilter === 'Travel Fans') {
      return matchesSearch && g.tags.includes('Travel');
    }
    return matchesSearch;
  });

  // ── Join handler ───────────────────────────────────────

  const handleJoin = async (groupId: string) => {
    if (joinedMap[groupId]) return;

    try {
      const { error } = await supabase
        .from('chat_room_members')
        .insert({ chat_room_id: groupId, role: 'member' });

      if (error) {
        console.warn('Join insert failed, using local fallback:', error.message);
      }
    } catch {
      console.warn('Join unavailable, using local fallback');
    }

    setJoinedMap((prev) => ({ ...prev, [groupId]: true }));
  };

  // ── Template press ─────────────────────────────────────

  const handleTemplatePress = (template: GroupTemplate) => {
    const templateMap: Record<string, string> = {
      'tpl-team': 'team',
      'tpl-match': 'match',
      'tpl-travel': 'travel',
      'tpl-city': 'city',
    };
    router.push(`/create-wc-group?template=${templateMap[template.id] || 'team'}` as any);
  };

  // ── Render template card ───────────────────────────────

  const renderTemplateCard = (template: GroupTemplate) => (
    <TouchableOpacity
      key={template.id}
      style={styles.templateCard}
      onPress={() => handleTemplatePress(template)}
      activeOpacity={0.8}
    >
      <Text style={styles.templateIcon}>{template.icon}</Text>
      <Text style={styles.templateLabel}>{template.label}</Text>
      <Text style={styles.templateDesc}>{template.description}</Text>
    </TouchableOpacity>
  );

  // ── Render group card ──────────────────────────────────

  const renderGroupCard = ({ item }: { item: WCFanGroupItem }) => {
    const isJoined = joinedMap[item.id] || false;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/fan-group/${item.id}` as any)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>{item.icon}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardMembers}>
              {item.memberCount.toLocaleString()} members
              {item.onlineCount > 0 && ` \u00B7 ${item.onlineCount} online`}
            </Text>
          </View>
          {isJoined ? (
            <View style={styles.joinedBadge}>
              <Text style={styles.joinedBadgeText}>Joined</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.joinButton}
              onPress={() => handleJoin(item.id)}
            >
              <Text style={styles.joinButtonText}>Join</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.publicBadgeRow}>
          {item.isPublic && (
            <View style={styles.publicBadge}>
              <Text style={styles.publicBadgeText}>Public</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>

        <View style={styles.tagShareRow}>
          <View style={styles.tagRow}>
            {item.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={(e) => { e.stopPropagation(); shareGroup({ id: item.id, name: item.name, memberCount: item.memberCount }); }}
          >
            <Share2 size={12} color={Colors.dark.textSecondary} />
          </TouchableOpacity>
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
        <Text style={styles.emptyIcon}>🌍</Text>
        <Text style={styles.emptyTitle}>No fan groups yet — create the first one!</Text>
      </View>
    );
  };

  // ── Header (search + filters + templates) ──────────────

  const renderListHeader = () => (
    <View>
      {/* Group Templates Section */}
      <Text style={styles.sectionTitle}>Create a WC Group</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.templatesRow}
      >
        {GROUP_TEMPLATES.map(renderTemplateCard)}
      </ScrollView>

      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Fan Groups</Text>
    </View>
  );

  // ── Main render ────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Search size={18} color={Colors.dark.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search WC fan groups..."
          placeholderTextColor={Colors.dark.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Filter pills */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTER_PILLS}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.pillRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.pill, activeFilter === item && styles.pillActive]}
            onPress={() => setActiveFilter(item)}
          >
            <Text style={[styles.pillText, activeFilter === item && styles.pillTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Group list */}
      <FlatList
        data={filteredGroups}
        keyExtractor={(item) => item.id}
        renderItem={renderGroupCard}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
    paddingVertical: 12,
    gap: 10,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: '#3a3a5a',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    minHeight: 44,
  },
  pillActive: {
    backgroundColor: Colors.dark.accentGreen,
    borderColor: Colors.dark.accentGreen,
  },
  pillText: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '600',
    lineHeight: 20,
  },
  pillTextActive: {
    color: '#ffffff',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 12,
  },
  templatesRow: {
    gap: 10,
    paddingBottom: 16,
  },
  templateCard: {
    width: 140,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    alignItems: 'center',
  },
  templateIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  templateLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  templateDesc: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${Colors.dark.accentGreen}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  cardMembers: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 1,
  },
  joinButton: {
    backgroundColor: Colors.dark.accentGreen,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  joinedBadge: {
    backgroundColor: `${Colors.dark.accentGreen}22`,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.dark.accentGreen,
  },
  joinedBadgeText: {
    color: Colors.dark.accentGreen,
    fontSize: 13,
    fontWeight: '700',
  },
  publicBadgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  publicBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Colors.dark.surfaceLight,
  },
  publicBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  cardDescription: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
  },
  tagShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  shareBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.dark.surfaceLight,
  },
  tagText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
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
  },
});
