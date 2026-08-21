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
  // v9.4.0 UAT Round 3 (#1): personalize the header. Reads from
  // users.display_name (set at sign-up) and falls back to the email
  // local-part / "there" so the greeting never renders "Hi undefined".
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Shared React Query hooks — data is deduplicated across screens
  const { data: city = '' } = useUserCity();
  const { data: games = [], isLoading: gamesLoading } = useGames(30);
  const { data: watchParties = [], isLoading: partiesLoading } = useWatchParties(city, 3);
  const { data: groups = [], isLoading: groupsLoading } = useMyGroups(3);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from('users')
          .select('display_name')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const name =
          data?.display_name ||
          (user.user_metadata as any)?.display_name ||
          user.email?.split('@')[0] ||
          null;
        setDisplayName(name);
      } catch {
        // Silent fallback: header just shows "Hi there".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  // v9.4.0 UAT Round 3 (#6): fetch fan-group affinity for each visible
  // watch party after the list resolves. Cheap: 3 parties on Home, one
  // small RPC per. Keyed by party.id so re-renders don't refetch.
  const [partyAffinity, setPartyAffinity] = useState<
    Record<
      string,
      { groupId: string; groupName: string; goingCount: number; distinctFans: number }[]
    >
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (watchParties.length === 0) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const partyIds = watchParties.map((p) => p.id);
      const results = await Promise.all(
        partyIds.map((pid) =>
          supabase.rpc('get_watch_party_group_affinity', {
            p_party_id: pid,
            p_viewer_id: user.id,
          }),
        ),
      );
      if (cancelled) return;
      const next: typeof partyAffinity = {};
      partyIds.forEach((pid, i) => {
        const rows = results[i].data ?? [];
        next[pid] = rows.map((r: any) => ({
          groupId: r.group_id,
          groupName: r.group_name,
          goingCount: r.going_count,
          distinctFans: r.distinct_fans ?? r.going_count,
        }));
      });
      setPartyAffinity(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [watchParties]);

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

  // v9.4.0 UAT Round 3 (#2): "Today's Games" carousel bled prior-day
  // finals into today because useGames returns anything within a 24h
  // finished-cutoff (server-side, TZ-agnostic). Add a local-day
  // window filter + a Today/Yesterday toggle so users can see finals
  // from either day intentionally.
  const [dayFilter, setDayFilter] = useState<'today' | 'yesterday'>('today');

  const filteredGames = useMemo(() => {
    // Local-day boundaries relative to the client's TZ.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    const [lo, hi] = dayFilter === 'today'
      ? [startOfToday, startOfTomorrow]
      : [startOfYesterday, startOfToday];

    const withinDay = games.filter((g) => {
      if (!g.scheduledAt) return false;
      const t = new Date(g.scheduledAt).getTime();
      return t >= lo && t < hi;
    });

    if (!interestSports || interestSports.size === 0) return withinDay;
    const filtered = withinDay.filter((g) => {
      const sport = (g.sport || '').toLowerCase();
      if (!sport) return false;
      return interestSports.has(sport);
    });
    // Don't hide everything if the interest filter would empty the
    // carousel — probably a user who picked an off-season sport. Fall
    // back to all of the day-scoped set.
    return filtered.length > 0 ? filtered : withinDay;
  }, [games, interestSports, dayFilter]);

  const loading = gamesLoading || partiesLoading || groupsLoading;

  // Realtime subscriptions — only active when tab is focused.
  // v8.6 P0: useFocusEffect now depends on `city` so the channel filter
  // re-binds when the user changes their home city. The v8.5 closure
  // captured an empty city on cold-boot (useUserCity returned '' until
  // the AsyncStorage seed finished) and never re-subscribed — so a Dallas
  // INSERT never reached this Home tab and the user saw their freshly-
  // created watch party arrive ~2 min later when the staleTime refetch
  // finally hit. cityRef stays for the per-payload writeback (the inner
  // setQueryData reads the latest city even mid-stream).
  const cityRef = useRef(city);
  cityRef.current = city;

  useFocusEffect(
    useCallback(() => {
      const unsubGames = subscribeToGames((_updatedGame) => {
        queryClient.invalidateQueries({ queryKey: ['games'] });
      });

      let unsubParties: (() => void) | undefined;
      if (city) {
        unsubParties = subscribeToWatchParties(
          city,
          (newParty) => {
            queryClient.setQueryData(['watchParties', cityRef.current, 3], (prev: any[] | undefined) =>
              [mapWatchPartyToDisplay(newParty), ...(prev || [])].slice(0, 5)
            );
            // Belt-and-braces: invalidate so the infinite-scroll cache on
            // Discover and any other consumer of ['watchParties'] also
            // refreshes immediately — fixes the "I created a party but
            // it's not on the list" symptom even when the channel filter
            // race somehow lost the INSERT.
            queryClient.invalidateQueries({ queryKey: ['watchPartiesInfinite'] });
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
    }, [city])
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
          <Text style={styles.greeting}>
            Hi {displayName || 'there'}
          </Text>
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
        <TouchableOpacity
          style={styles.bellButton}
          onPress={() => router.push('/notifications' as any)}
        >
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
        {/* Today's / Yesterday's Games — See All routes to the Game Day
            tab (v9.4.2: previously routed to Discover which drops users on
            fan groups instead of the full scoreboard they expect). */}
        <SectionHeader
          title={dayFilter === 'today' ? "Today's Games" : "Yesterday's Games"}
          actionText="See All →"
          onAction={() => router.push('/(tabs)/game-day')}
        />
        <View style={styles.dayToggleRow}>
          <TouchableOpacity
            style={[styles.dayChip, dayFilter === 'today' && styles.dayChipActive]}
            onPress={() => setDayFilter('today')}
          >
            <Text style={[styles.dayChipText, dayFilter === 'today' && styles.dayChipTextActive]}>
              Today
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dayChip, dayFilter === 'yesterday' && styles.dayChipActive]}
            onPress={() => setDayFilter('yesterday')}
          >
            <Text style={[styles.dayChipText, dayFilter === 'yesterday' && styles.dayChipTextActive]}>
              Yesterday
            </Text>
          </TouchableOpacity>
        </View>
        {filteredGames.length > 0 ? (
          <FlatList
            data={filteredGames}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={true}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.gameRow}
            renderItem={({ item }) => (
              <GameCard
                game={item}
                onPress={() => router.push(`/game/${item.id}` as any)}
              />
            )}
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
            <WatchPartyCard
              key={party.id}
              party={party}
              affinity={partyAffinity[party.id]}
            />
          ))
        ) : (
          <View style={styles.promoCard}>
            <Text style={styles.promoEmoji}>🎉</Text>
            <Text style={styles.promoTitle}>
              Be the first to host{city ? ` in ${city}` : ' a watch party'}!
            </Text>
            <Text style={styles.promoSubtitle}>
              Fans nearby will see your event and can RSVP. Pick a game, set a
              venue, invite your crew.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/create-watch-party')}
            >
              <Text style={styles.emptyButtonText}>Create Watch Party</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Your Groups — v9.0 pivot: Groups tab folded into Discover, so
            "See All" now routes there. */}
        <SectionHeader
          title="Your Groups"
          actionText="See All →"
          onAction={() => router.push('/(tabs)/discover')}
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
  greeting: {
    fontSize: 15,
    color: Colors.dark.text,
    fontWeight: '500',
    marginTop: 6,
  },
  dayToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  dayChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayChipActive: {
    backgroundColor: Colors.dark.accent + '22',
    borderColor: Colors.dark.accent,
  },
  dayChipText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: '500',
  },
  dayChipTextActive: {
    color: Colors.dark.accent,
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
    // v9.4.2 UAT: was 20 — insufficient once the FAB (bottom:24 + size:56)
    // sits above the tab bar. Bumped so the final "Your Groups" section
    // isn't clipped by the FAB on Home on smaller Android devices.
    height: 96,
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
  promoCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.dark.accent + '40',
  },
  promoEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  promoTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  promoSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
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
