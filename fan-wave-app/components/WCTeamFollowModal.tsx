import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { WC_TEAMS, getTeamsByGroup, WCTeam } from '@/constants/WorldCupData';
import { supabase } from '@/lib/supabase';

const ALL_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

import { WC_LEAGUE_ID } from '@/constants/WorldCupIds';

const GREEN = Colors.dark.accentGreen;
const GREEN_DARK = Colors.dark.accentGreenDark;

interface WCTeamFollowModalProps {
  visible: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

interface GroupSection {
  group: string;
  teams: WCTeam[];
}

export function WCTeamFollowModal({ visible, onClose, onUpdate }: WCTeamFollowModalProps) {
  const [followedCodes, setFollowedCodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Map of team code → Supabase team UUID (loaded once)
  const [codeToId, setCodeToId] = useState<Record<string, string>>({});

  // Load followed teams from Supabase when modal becomes visible
  useEffect(() => {
    if (!visible) return;

    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch WC team rows so we can map code ↔ UUID
        const { data: wcTeams } = await supabase
          .from('teams')
          .select('id, code')
          .eq('league_id', WC_LEAGUE_ID);

        if (wcTeams) {
          const mapping: Record<string, string> = {};
          for (const t of wcTeams) mapping[t.code] = t.id;
          setCodeToId(mapping);

          // Fetch user's followed WC teams
          const wcTeamIds = wcTeams.map((t) => t.id);
          const { data: follows } = await supabase
            .from('user_team_follows')
            .select('team_id')
            .eq('user_id', user.id)
            .in('team_id', wcTeamIds);

          if (follows) {
            const idToCode: Record<string, string> = {};
            for (const t of wcTeams) idToCode[t.id] = t.code;
            setFollowedCodes(new Set(follows.map((f) => idToCode[f.team_id]).filter(Boolean)));
          }
        }
      } catch {
        // Supabase unavailable — start with empty set
      }
    }

    load();
  }, [visible]);

  const toggleFollow = useCallback(
    async (code: string) => {
      const teamId = codeToId[code];
      const wasFollowing = followedCodes.has(code);

      // Optimistic UI update
      setFollowedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
        }
        return next;
      });

      // Persist to Supabase
      if (teamId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          if (wasFollowing) {
            await supabase.rpc('unfollow_team', {
              p_user_id: user.id,
              p_team_id: teamId,
            });
          } else {
            await supabase.rpc('follow_team', {
              p_user_id: user.id,
              p_team_id: teamId,
              p_tier: 'social',
            });
          }
        } catch {
          // Revert on failure
          setFollowedCodes((prev) => {
            const reverted = new Set(prev);
            if (wasFollowing) {
              reverted.add(code);
            } else {
              reverted.delete(code);
            }
            return reverted;
          });
        }
      }
    },
    [codeToId, followedCodes],
  );

  const handleDone = useCallback(() => {
    onUpdate?.();
    onClose();
  }, [onClose, onUpdate]);

  // Build sections filtered by search
  const sections: GroupSection[] = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return ALL_GROUPS.map((group: string) => {
      let teams = getTeamsByGroup(group);
      if (query) {
        teams = teams.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            t.code.toLowerCase().includes(query) ||
            t.confederation.toLowerCase().includes(query),
        );
      }
      return { group, teams };
    }).filter((s) => s.teams.length > 0);
  }, [searchQuery]);

  const renderTeamRow = useCallback(
    ({ item }: { item: WCTeam }) => {
      const isFollowing = followedCodes.has(item.code);
      return (
        <View style={styles.teamRow}>
          <Text style={styles.teamFlag}>{item.flag}</Text>
          <View style={styles.teamInfo}>
            <Text style={styles.teamName}>{item.name}</Text>
            <View style={styles.confBadge}>
              <Text style={styles.confText}>{item.confederation}</Text>
            </View>
          </View>
          <TouchableOpacity
              style={[
                styles.followBtn,
                isFollowing ? styles.followBtnActive : styles.followBtnInactive,
              ]}
              onPress={() => toggleFollow(item.code)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.followBtnText,
                  isFollowing ? styles.followBtnTextActive : styles.followBtnTextInactive,
                ]}
              >
                {isFollowing ? '\u2713 Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
        </View>
      );
    },
    [followedCodes, toggleFollow],
  );

  // Flatten sections into a renderable list with headers
  const flatData = useMemo(() => {
    const items: Array<{ type: 'header'; group: string } | { type: 'team'; team: WCTeam }> = [];
    for (const section of sections) {
      items.push({ type: 'header', group: section.group });
      for (const team of section.teams) {
        items.push({ type: 'team', team });
      }
    }
    return items;
  }, [sections]);

  const renderItem = useCallback(
    ({ item }: { item: (typeof flatData)[number] }) => {
      if (item.type === 'header') {
        return (
          <View style={styles.groupHeader}>
            <Text style={styles.groupHeaderText}>Group {item.group}</Text>
          </View>
        );
      }
      return renderTeamRow({ item: item.team });
    },
    [renderTeamRow],
  );

  const keyExtractor = useCallback(
    (item: (typeof flatData)[number], index: number) => {
      if (item.type === 'header') return `header-${item.group}`;
      return item.team.code;
    },
    [],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleDone}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Title */}
          <Text style={styles.title}>Follow Soccer Cup Teams</Text>

          {/* Search bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search teams..."
              placeholderTextColor={Colors.dark.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Team list */}
          <FlatList
            data={flatData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.countBadge}>
              Following {followedCodes.size} team{followedCodes.size !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={handleDone}
              activeOpacity={0.8}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.surfaceLight,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.dark.text,
    textAlign: 'center',
    paddingVertical: 12,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  groupHeader: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  groupHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: GREEN,
    letterSpacing: 0.5,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  teamFlag: {
    fontSize: 24,
    marginRight: 12,
  },
  teamInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  confBadge: {
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  confText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  followBtnActive: {
    borderColor: GREEN,
    backgroundColor: GREEN_DARK,
  },
  followBtnInactive: {
    borderColor: Colors.dark.border,
    backgroundColor: 'transparent',
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  followBtnTextActive: {
    color: GREEN,
  },
  followBtnTextInactive: {
    color: Colors.dark.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  countBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  doneBtn: {
    backgroundColor: GREEN,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 20,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
});
