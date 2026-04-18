import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { TierPicker } from '@/components/TierPicker';
import {
  UserTeamFollow,
  FollowTier,
  TIER_BY_ID,
  getTierDistribution,
} from '@/constants/FollowTiers';
import { loadFollowsFromStorage } from '@/lib/tierUtils';
import { supabase } from '@/lib/supabase';

export default function MyTeamsScreen() {
  const router = useRouter();
  const [teams, setTeams] = useState<UserTeamFollow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { data, error } = await supabase.rpc('get_user_teams', {
          p_user_id: userData.user.id,
        });
        if (!error && data && data.length > 0) {
          setTeams(data);
          setLoading(false);
          return;
        }
      }
    } catch {}
    // Fallback to AsyncStorage
    const stored = await loadFollowsFromStorage();
    setTeams(stored);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const handleTierChange = useCallback(
    async (teamId: string, newTier: FollowTier) => {
      // Optimistic update
      setTeams((prev) =>
        prev.map((t) => (t.team_id === teamId ? { ...t, tier: newTier } : t))
      );
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await supabase.rpc('follow_team', {
            p_user_id: userData.user.id,
            p_team_id: teamId,
            p_tier: newTier,
          });
        }
      } catch {}
    },
    []
  );

  const handleUnfollow = useCallback(
    (team: UserTeamFollow) => {
      Alert.alert(
        'Unfollow Team',
        `Stop following ${team.team_name || 'this team'}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unfollow',
            style: 'destructive',
            onPress: async () => {
              setTeams((prev) => prev.filter((t) => t.team_id !== team.team_id));
              try {
                const { data: userData } = await supabase.auth.getUser();
                if (userData?.user) {
                  await supabase.rpc('unfollow_team', {
                    p_user_id: userData.user.id,
                    p_team_id: team.team_id,
                  });
                }
              } catch {}
            },
          },
        ]
      );
    },
    []
  );

  const dist = getTierDistribution(teams);
  const distParts: string[] = [];
  if (dist.lite > 0) distParts.push(`${dist.lite} 📊`);
  if (dist.social > 0) distParts.push(`${dist.social} 👥`);
  if (dist.all_in > 0) distParts.push(`${dist.all_in} 🔥`);

  const renderTeam = ({ item }: { item: UserTeamFollow }) => {
    const tierDef = TIER_BY_ID[item.tier];
    const isExpanded = expandedId === item.team_id;

    return (
      <View>
        <TouchableOpacity
          style={[styles.teamRow, isExpanded && { borderColor: tierDef.color, borderWidth: 1.5 }]}
          activeOpacity={0.7}
          onPress={() => setExpandedId(isExpanded ? null : item.team_id)}
          onLongPress={() => handleUnfollow(item)}
        >
          <Text style={styles.teamIcon}>{item.sport_icon || '🏟️'}</Text>
          <View style={styles.teamInfo}>
            <Text style={styles.teamName}>{item.team_name || item.team_id}</Text>
            <Text style={styles.teamMeta}>
              {item.team_city || ''}{item.league_name ? ` · ${item.league_name}` : ''}
            </Text>
          </View>
          <View style={[styles.tierBadge, { backgroundColor: `${tierDef.color}22`, borderColor: tierDef.color }]}>
            <Text style={[styles.tierBadgeText, { color: tierDef.color }]}>
              {tierDef.icon} {tierDef.shortLabel}
            </Text>
          </View>
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.tierPickerContainer}>
            <TierPicker
              selectedTier={item.tier}
              onSelect={(newTier) => handleTierChange(item.team_id, newTier)}
            />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={Colors.dark.accent} style={{ marginTop: 100 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Teams</Text>
        <View style={{ width: 32 }} />
      </View>

      {teams.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            Following {teams.length} team{teams.length !== 1 ? 's' : ''}
          </Text>
          {distParts.length > 0 && (
            <Text style={styles.summaryDist}>{distParts.join(' · ')}</Text>
          )}
        </View>
      )}

      {teams.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏟️</Text>
          <Text style={styles.emptyTitle}>No teams on your roster yet</Text>
          <Text style={styles.emptySubtitle}>Follow your squads to unlock the full experience</Text>
        </View>
      ) : (
        <FlatList
          data={teams}
          keyExtractor={(item) => item.team_id}
          renderItem={renderTeam}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.followMoreBtn}
          onPress={() => router.push('/(auth)/onboarding-teams')}
        >
          <Text style={styles.followMoreText}>+ Follow More Teams</Text>
        </TouchableOpacity>
      </View>
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
    borderBottomColor: Colors.dark.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  summaryDist: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    gap: 12,
  },
  teamIcon: {
    fontSize: 24,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  teamMeta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tierPickerContainer: {
    marginTop: -6,
    marginBottom: 10,
    marginHorizontal: 4,
    padding: 14,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  followMoreBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.dark.accent,
    alignItems: 'center',
  },
  followMoreText: {
    color: Colors.dark.accent,
    fontSize: 15,
    fontWeight: '700',
  },
});
