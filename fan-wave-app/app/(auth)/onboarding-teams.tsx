import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Search, Check, ArrowLeft } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { SPORTS } from '@/constants/Sports';
import { TierPicker } from '@/components/TierPicker';
import { FollowTier, TIER_BY_ID, getTierDistribution } from '@/constants/FollowTiers';
import { supabase } from '@/lib/supabase';

interface Team {
  id: string;
  name: string;
  code: string;
  city: string;
  sport: string;
  league: string;
  icon: string;
}

// Sport name → sport key mapping for filtering
const SPORT_NAME_TO_KEY: Record<string, string> = {
  'NFL': 'nfl', 'NBA': 'nba', 'MLB': 'mlb', 'Soccer': 'soccer', 'MLS': 'mls',
  'NHL': 'nhl', 'College Football': 'cfb', 'College Basketball': 'cbb', 'UFC': 'ufc',
};

export default function OnboardingTeamsScreen() {
  const router = useRouter();
  const { selectedSports } = useLocalSearchParams<{ selectedSports: string }>();

  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [followedTeams, setFollowedTeams] = useState<Map<string, FollowTier>>(new Map());
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  // Fetch teams from Supabase
  useEffect(() => {
    async function fetchTeams() {
      try {
        const { data, error } = await supabase
          .from('teams')
          .select('id, name, code, city, league:leagues(name, sport:sports(name, icon))')
          .order('name');

        if (!error && data) {
          const mapped: Team[] = data.map((t: any) => ({
            id: t.id,
            name: t.name,
            code: t.code || '',
            city: t.city || '',
            sport: SPORT_NAME_TO_KEY[t.league?.sport?.name] || 'other',
            league: t.league?.name || '',
            icon: t.league?.sport?.icon || '🏅',
          }));
          setAllTeams(mapped);
        }
      } catch {
        // Supabase unavailable — show empty state
      } finally {
        setLoadingTeams(false);
      }
    }
    fetchTeams();
  }, []);

  const sportsList = useMemo(() => {
    const ids = selectedSports?.split(',') ?? [];
    return SPORTS.filter((s) => ids.includes(s.id));
  }, [selectedSports]);

  const filteredTeams = useMemo(() => {
    let teams = allTeams;

    // Filter by selected sports from previous screen
    const sportIds = selectedSports?.split(',') ?? [];
    if (sportIds.length > 0) {
      teams = teams.filter((t) => sportIds.includes(t.sport));
    }

    // Filter by active sport pill
    if (activeFilter !== 'all') {
      teams = teams.filter((t) => t.sport === activeFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      teams = teams.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.city.toLowerCase().includes(q) ||
          t.code.toLowerCase().includes(q)
      );
    }

    return teams;
  }, [allTeams, activeFilter, searchQuery, selectedSports]);

  const toggleFollow = useCallback((id: string) => {
    setFollowedTeams((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
        setExpandedTeam(null);
      } else {
        next.set(id, 'social');
        setExpandedTeam(id);
      }
      return next;
    });
  }, []);

  const setTeamTier = useCallback((id: string, tier: FollowTier) => {
    setFollowedTeams((prev) => {
      const next = new Map(prev);
      next.set(id, tier);
      return next;
    });
  }, []);

  const handleContinue = async () => {
    const teamsWithTiers = Array.from(followedTeams.entries()).map(([teamId, tier]) => ({
      teamId,
      tier,
    }));

    // Save to AsyncStorage as local cache
    await AsyncStorage.setItem('followed_teams', JSON.stringify(teamsWithTiers));

    // Persist to Supabase user_team_follows
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        for (const { teamId, tier } of teamsWithTiers) {
          await supabase.rpc('follow_team', {
            p_user_id: user.id,
            p_team_id: teamId,
            p_tier: tier,
          });
        }
      }
    } catch {
      // Supabase unavailable — local cache still works
    }

    router.push({
      pathname: '/(auth)/onboarding-city',
      params: {
        followedTeams: teamsWithTiers.map((t) => t.teamId).join(','),
        selectedSports: selectedSports ?? '',
      },
    });
  };

  const tierDistText = useMemo(() => {
    if (followedTeams.size === 0) return '0 selected';
    const tiers = Array.from(followedTeams.values());
    const dist = { lite: 0, social: 0, all_in: 0 };
    tiers.forEach((t) => dist[t]++);
    const parts: string[] = [];
    if (dist.lite > 0) parts.push(`${dist.lite} 📊`);
    if (dist.social > 0) parts.push(`${dist.social} 👥`);
    if (dist.all_in > 0) parts.push(`${dist.all_in} 🔥`);
    return `${followedTeams.size} teams (${parts.join(' · ')})`;
  }, [followedTeams]);

  const renderTeam = ({ item }: { item: Team }) => {
    const isFollowed = followedTeams.has(item.id);
    const tier = followedTeams.get(item.id);
    const isExpanded = expandedTeam === item.id && isFollowed;
    const tierDef = tier ? TIER_BY_ID[tier] : null;

    return (
      <View>
        <TouchableOpacity
          style={[styles.teamRow, isFollowed && { borderColor: tierDef?.color || Colors.dark.accent, borderWidth: 1.5 }]}
          activeOpacity={0.7}
          onPress={() => toggleFollow(item.id)}
        >
          <View style={styles.teamIcon}>
            <Text style={styles.teamEmoji}>{item.icon}</Text>
          </View>
          <View style={styles.teamInfo}>
            <Text style={styles.teamName}>{item.name}</Text>
            <Text style={styles.teamMeta}>
              {item.city} · {item.league}
            </Text>
          </View>
          {isFollowed ? (
            <TouchableOpacity
              style={[styles.followingButton, { borderColor: tierDef?.color || Colors.dark.success }]}
              onPress={() => setExpandedTeam(isExpanded ? null : item.id)}
            >
              <Text style={[styles.followingText, { color: tierDef?.color || Colors.dark.success }]}>
                {tierDef?.icon} {tierDef?.shortLabel || 'Following'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.followButton}>
              <Text style={styles.followButtonText}>Follow</Text>
            </View>
          )}
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.tierExpandedSection}>
            <TierPicker
              compact
              selectedTier={tier || 'social'}
              onSelect={(newTier) => setTeamTier(item.id, newTier)}
            />
            <View style={[styles.tierDescBox, { borderLeftColor: tierDef?.color || '#6c5ce7' }]}>
              <Text style={[styles.tierDescTitle, { color: tierDef?.color || '#6c5ce7' }]}>
                {tierDef?.icon || '👥'} {tierDef?.label || 'Fan Zone'}
              </Text>
              <Text style={styles.tierDescText}>
                {tierDef?.description || 'Scores + group chat, watch parties, clips in your feed'}
              </Text>
              <Text style={styles.tierDescIncludes}>
                Includes: {tierDef?.includesSummary.join(' · ') || 'Scores · Groups · Parties · Clips'}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Follow your teams</Text>
        <Text style={styles.subtitle}>
          Search and follow the teams you root for
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Search size={18} color={Colors.dark.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search teams..."
          placeholderTextColor={Colors.dark.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Sport filter pills */}
      <View style={styles.pillsWrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContainer}
      >
        <TouchableOpacity
          style={[styles.pill, activeFilter === 'all' && styles.pillActive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text
            style={[
              styles.pillText,
              activeFilter === 'all' && styles.pillTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>
        {sportsList.map((sport) => (
          <TouchableOpacity
            key={sport.id}
            style={[
              styles.pill,
              activeFilter === sport.id && styles.pillActive,
            ]}
            onPress={() => setActiveFilter(sport.id)}
          >
            <Text
              style={[
                styles.pillText,
                activeFilter === sport.id && styles.pillTextActive,
              ]}
            >
              {sport.icon} {sport.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>

      {/* Team list */}
      <FlatList
        data={filteredTeams}
        renderItem={renderTeam}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.tierLegend}>
            <Text style={styles.tierLegendTitle}>Choose a follow level per team:</Text>
            <View style={styles.tierLegendItem}>
              <Text style={[styles.tierLegendIcon, { color: '#0096ff' }]}>📊 Lite</Text>
              <Text style={styles.tierLegendDesc}>Scores & top highlights only</Text>
            </View>
            <View style={styles.tierLegendItem}>
              <Text style={[styles.tierLegendIcon, { color: '#6c5ce7' }]}>👥 Social</Text>
              <Text style={styles.tierLegendDesc}>+ Groups, watch parties & clips</Text>
            </View>
            <View style={styles.tierLegendItem}>
              <Text style={[styles.tierLegendIcon, { color: '#ff4444' }]}>🔥 All In</Text>
              <Text style={styles.tierLegendDesc}>Everything + live alerts & moments</Text>
            </View>
          </View>
        }
      />

      {/* Bottom area */}
      <View style={styles.bottom}>
        <Text style={styles.countText}>
          {tierDistText}
        </Text>
        <TouchableOpacity
          style={[
            styles.button,
            followedTeams.size === 0 && styles.buttonDisabled,
          ]}
          activeOpacity={0.8}
          disabled={followedTeams.size === 0}
          onPress={handleContinue}
        >
          <Text style={styles.buttonText}>Continue</Text>
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
  backBtn: {
    alignSelf: 'flex-start',
    padding: 4,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  tierExpandedSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  tierDescBox: {
    marginTop: 10,
    backgroundColor: Colors.dark.surface,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
  },
  tierDescTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  tierDescText: {
    fontSize: 13,
    color: Colors.dark.text,
    lineHeight: 18,
    marginBottom: 4,
  },
  tierDescIncludes: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  tierLegend: {
    marginBottom: 14,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  tierLegendTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  tierLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tierLegendIcon: {
    fontSize: 13,
    fontWeight: '700',
    width: 72,
  },
  tierLegendDesc: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    marginHorizontal: 24,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: Colors.dark.text,
  },
  pillsWrapper: {
    height: 48,
    marginBottom: 4,
  },
  pillsContainer: {
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginRight: 8,
    height: 36,
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: 'rgba(108, 92, 231, 0.25)',
    borderColor: Colors.dark.accent,
  },
  pillText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  pillTextActive: {
    color: Colors.dark.text,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  teamIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamEmoji: {
    fontSize: 20,
  },
  teamInfo: {
    flex: 1,
    marginLeft: 12,
  },
  teamName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Colors.dark.text,
  },
  teamMeta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  followButton: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  followButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  followingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.success,
    gap: 4,
  },
  followingText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.success,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  countText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: Colors.dark.accent,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
