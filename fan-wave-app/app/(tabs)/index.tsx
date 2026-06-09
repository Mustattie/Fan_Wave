import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { GameCard } from '@/components/GameCard';
import { WatchPartyCard } from '@/components/WatchPartyCard';
import { GroupCard } from '@/components/GroupCard';
import { SectionHeader } from '@/components/SectionHeader';
import { subscribeToGames, subscribeToWatchParties } from '@/lib/realtime';
import { mapGameToDisplay, mapWatchPartyToDisplay } from '@/lib/mappers';
import { useGames, useWatchParties, useMyGroups, useUserCity } from '@/hooks/useData';
import { queryClient } from '@/hooks/useQueryClient';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  // Shared React Query hooks — data is deduplicated across screens
  const { data: city = '' } = useUserCity();
  const { data: games = [], isLoading: gamesLoading } = useGames(30);
  const { data: watchParties = [], isLoading: partiesLoading } = useWatchParties(city, 3);
  const { data: groups = [], isLoading: groupsLoading } = useMyGroups(3);

  // User interests for the "Today's Games" carousel:
  //   • selected_sports — AsyncStorage list of lowercase sport ids set during
  //     onboarding-sports (e.g. ['nfl','nba','soccer']).
  //   • followed-team sport ids — derived from user_team_follows joined to
  //     teams→leagues→sports. We store the sport NAME lowercased so it
  //     matches what mapGameToDisplay normalises games.sport_id into.
  //
  // Falls back to "no filter" when the user has no signals on file so the
  // empty-case still shows all games (and we don't hide everything before
  // onboarding finishes propagating to AsyncStorage).
  const [interestSports, setInterestSports] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('selected_sports');
        const fromStorage: string[] = raw ? JSON.parse(raw) : [];
        const set = new Set(fromStorage.map((s) => s.toString().toLowerCase()));

        // Followed teams → sport names. Cheap: one RPC, also handles WC
        // (the FIFA World Cup league joins to the 'Soccer' sport).
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: follows } = await supabase.rpc('get_user_teams', {
              p_user_id: user.id,
            });
            (follows || []).forEach((row: any) => {
              if (row.sport_name) {
                set.add(String(row.sport_name).toLowerCase());
              }
            });
          }
        } catch {
          // Network failure — selected_sports alone is fine.
        }

        if (!cancelled) {
          setInterestSports(set.size > 0 ? set : new Set());
        }
      } catch {
        if (!cancelled) setInterestSports(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGames = useMemo(() => {
    if (!interestSports || interestSports.size === 0) return games;
    const filtered = games.filter((g) => {
      const sport = (g.sport || '').toLowerCase();
      if (!sport) return false;
      return interestSports.has(sport);
    });
    // Don't hide everything if the filter would empty the carousel —
    // probably a user who picked an off-season sport. Fall back to all.
    return filtered.length > 0 ? filtered : games;
  }, [games, interestSports]);

  const loading = gamesLoading || partiesLoading || groupsLoading;

  // Realtime subscriptions — only active when tab is focused
  const cityRef = useRef(city);
  cityRef.current = city;

  useFocusEffect(
    useCallback(() => {
      const unsubGames = subscribeToGames((_updatedGame) => {
        // Invalidate ALL ['games', limit] cache entries (we used to write
        // straight to ['games', 10] but the home feed now requests
        // useGames(30), so the previous setQueryData targeted a queryKey
        // that doesn't exist and every live update was silently dropped).
        // Invalidate triggers React Query to refetch with the actual
        // current key — also clears AsyncStorage cache via the queryFn.
        queryClient.invalidateQueries({ queryKey: ['games'] });
      });

      let unsubParties: (() => void) | undefined;
      if (cityRef.current) {
        unsubParties = subscribeToWatchParties(
          cityRef.current,
          (newParty) => {
            queryClient.setQueryData(['watchParties', cityRef.current, 3], (prev: any[] | undefined) =>
              [mapWatchPartyToDisplay(newParty), ...(prev || [])].slice(0, 5)
            );
          },
          (updatedParty) => {
            queryClient.setQueryData(['watchParties', cityRef.current, 3], (prev: any[] | undefined) =>
              (prev || []).map((p) => (p.id === updatedParty.id ? mapWatchPartyToDisplay(updatedParty) : p))
            );
          },
        );
      }

      return () => {
        unsubGames();
        unsubParties?.();
      };
    }, [])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['games'] });
    await queryClient.invalidateQueries({ queryKey: ['watchParties'] });
    await queryClient.invalidateQueries({ queryKey: ['myGroups'] });
    setRefreshing(false);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Fan Sphere 🌐</Text>
          <Text style={styles.subtitle}>
            📍 {city} ·{' '}
            <Text
              style={styles.changeLink}
              onPress={() => router.push('/(tabs)/discover')}
            >
              Change
            </Text>
          </Text>
        </View>
        <TouchableOpacity style={styles.bellButton}>
          <Bell size={24} color={Colors.dark.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.dark.accent}
            colors={[Colors.dark.accent]}
          />
        }
      >
        {/* Today's Games */}
        <SectionHeader
          title="Today's Games"
          actionText="See All →"
          onAction={() => router.push('/(tabs)/discover')}
        />
        {filteredGames.length > 0 ? (
          <FlatList
            data={filteredGames}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={true}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.gameRow}
            renderItem={({ item }) => <GameCard game={item} />}
          />
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No games on deck today — check back tomorrow!</Text>
          </View>
        )}

        {/* Watch Parties */}
        <SectionHeader
          title="Watch Parties Near You"
          actionText="See All →"
          onAction={() => router.push('/(tabs)/discover')}
        />
        {watchParties.length > 0 ? (
          watchParties.map((party) => (
            <WatchPartyCard key={party.id} party={party} />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No watch parties nearby yet — rally your crew!</Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/create-watch-party')}
            >
              <Text style={styles.emptyButtonText}>Create Watch Party</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Your Groups */}
        <SectionHeader
          title="Your Groups"
          actionText="See All →"
          onAction={() => router.push('/(tabs)/groups')}
        />
        {groups.length > 0 ? (
          groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Find your crew — join a fan group!</Text>
          </View>
        )}

        <View style={styles.spacer} />
      </ScrollView>

      {/* FAB for creating a watch party */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/create-watch-party')}
      >
        <Plus size={28} color={Colors.dark.text} />
      </TouchableOpacity>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  changeLink: {
    color: Colors.dark.accent,
  },
  bellButton: {
    padding: 8,
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  gameRow: {
    gap: 12,
    paddingVertical: 4,
  },
  spacer: {
    height: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 12,
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.dark.accent,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});
