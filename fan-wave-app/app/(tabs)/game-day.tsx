import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { GameCard } from '@/components/GameCard';
import { SportPillRow } from '@/components/SportPill';
import { subscribeToGames } from '@/lib/realtime';
import { mapGameToDisplay, type GameDisplay } from '@/lib/mappers';
import { useGames } from '@/hooks/useData';
import { queryClient } from '@/hooks/useQueryClient';
import { supabase } from '@/lib/supabase';
import { SPORTS, SPORT_BY_ID } from '@/constants/Sports';

// Game Day (v9.0.1):
// A single scrollable screen showing today's games across every sport the
// user follows, grouped by status: Live now → Upcoming today → Final today.
//
// v9.0.1 wires tap → /game/[id] (see app/game/[id].tsx). v9.1 lands live
// per-game chat + MVP voting on top of the same detail route.
export default function GameDayScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [activeSport, setActiveSport] = useState<string>('all');

  // Pull a healthy pool — useGames already filters to
  // (live) ∪ (scheduled within a few hours forward) ∪ (post within last 24h),
  // which is a superset of "today's games". We do the strict today-only
  // window locally so time-zone edge cases stay client-side.
  const { data: games = [], isLoading } = useGames(50);

  // Interest filter mirrors app/(tabs)/index.tsx: union of AsyncStorage
  // selected_sports + followed-team sport names via get_user_teams RPC.
  // Falls back to "no filter" if the user has no signals.
  const [interestSports, setInterestSports] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('selected_sports');
        const fromStorage: string[] = raw ? JSON.parse(raw) : [];
        const set = new Set(fromStorage.map((s) => s.toString().toLowerCase()));

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

  // Realtime patch buffer — subscribeToGames delivers the raw DB row.
  // We patch by id into local overrides and merge over the react-query
  // cache to avoid a full-list invalidation flicker.
  const [liveOverrides, setLiveOverrides] = useState<Record<string, GameDisplay>>({});

  // Merge overrides over the react-query snapshot in one pass.
  const mergedGames = useMemo(
    () => games.map((g) => liveOverrides[g.id] || g),
    [games, liveOverrides],
  );

  // Interest filter — union of AsyncStorage selected_sports + followed-team
  // sport names. Skipped entirely for a specific sport-pill selection
  // (user is explicitly asking to see that sport).
  const interestFiltered = useMemo(() => {
    if (activeSport !== 'all') {
      return mergedGames.filter(
        (g) => (g.sport || '').toLowerCase() === activeSport,
      );
    }
    if (!interestSports || interestSports.size === 0) return mergedGames;
    const filtered = mergedGames.filter((g) => {
      const sport = (g.sport || '').toLowerCase();
      if (!sport) return false;
      return interestSports.has(sport);
    });
    // Same fallback as Home: don't hide everything if the user's interests
    // don't intersect today's slate (off-season sport, etc.).
    return filtered.length > 0 ? filtered : mergedGames;
  }, [mergedGames, interestSports, activeSport]);

  // useGames server-side-scopes to
  // (status='in') ∪ (status='scheduled' within ~4h forward) ∪ (status='post'
  // within last 24h). The finished leg of that union is a rolling 24h
  // window, NOT a calendar day — so at 9:42 AM it still carries
  // yesterday's 1:10 PM games, and "Final today" listed them as today's
  // results (iOS UAT 2026-09-09, BUG-1).
  //
  // GameDisplay has carried `scheduledAt` since v9.4.0 (added for Home's
  // Today/Yesterday toggle), so the strict local-day cut the original
  // TODO deferred is available here now. Same boundary maths as
  // app/(tabs)/index.tsx: midnight-to-midnight in the device's timezone,
  // keyed off kickoff time.
  const startOfLocalDay = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Recomputed whenever the games list changes, which covers the
    // pull-to-refresh and realtime paths. A screen left open across
    // midnight re-cuts on the next update rather than at the stroke of
    // 12 — acceptable; the alternative is a timer nobody watches.
  }, [interestFiltered]);

  const startedToday = useCallback(
    (g: GameDisplay) => {
      if (!g.scheduledAt) return false;
      const t = new Date(g.scheduledAt).getTime();
      if (!Number.isFinite(t)) return false;
      return t >= startOfLocalDay && t < startOfLocalDay + 24 * 60 * 60 * 1000;
    },
    [startOfLocalDay],
  );

  // Live is exempt from the day cut on purpose: a game that tipped at
  // 11:40 PM and is still running at 12:10 AM is live *now*, and burying
  // it because the calendar rolled over would be the more surprising bug.
  const liveGames = useMemo(
    () => interestFiltered.filter((g) => g.status === 'live'),
    [interestFiltered],
  );
  // Upcoming keeps the server's forward grace period so a 12:30 AM kickoff
  // is still reachable from the 11 PM slate — "what's next" is the
  // question this section answers, not "what shares my date".
  const upcomingGames = useMemo(
    () => interestFiltered.filter((g) => g.status === 'scheduled'),
    [interestFiltered],
  );
  // Final is the section that claims a date, so it is the one that has to
  // honour it. Games with no kickoff timestamp are excluded rather than
  // assumed-today: an undated final is exactly the row we cannot vouch for.
  const finalGames = useMemo(
    () => interestFiltered.filter((g) => g.status === 'final' && startedToday(g)),
    [interestFiltered, startedToday],
  );

  // Sport-pill options: "All" plus every sport that has a game today.
  // Preload from constants/Sports.ts for canonical labels/order.
  const sportPills = useMemo(() => {
    const present = new Set<string>();
    mergedGames.forEach((g) => {
      const s = (g.sport || '').toLowerCase();
      if (s) present.add(s);
    });
    // Also let currently-active sport survive an interim empty state.
    if (activeSport !== 'all') present.add(activeSport);
    const inOrder: { id: string; label: string }[] = SPORTS
      .filter((s) => present.has(s.id))
      .map((s) => ({
        id: s.id as string,
        label: `${s.icon} ${s.name}`,
      }));
    // Any sports NOT in constants/Sports.ts (e.g. "worldcup") — append.
    Array.from(present).forEach((id) => {
      if (!SPORT_BY_ID[id]) {
        inOrder.push({ id, label: id.toUpperCase() });
      }
    });
    return [{ id: 'all', label: 'All' }, ...inOrder];
  }, [mergedGames, activeSport]);

  // Realtime: patch specific games as ESPN sync fires UPDATEs.
  useFocusEffect(
    useCallback(() => {
      const unsub = subscribeToGames((updatedRow) => {
        try {
          const mapped = mapGameToDisplay(updatedRow);
          setLiveOverrides((prev) => ({ ...prev, [mapped.id]: mapped }));
        } catch {
          // Bad payload — invalidate the whole list as a safety net.
          queryClient.invalidateQueries({ queryKey: ['games'] });
        }
      });
      return () => {
        unsub();
      };
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setLiveOverrides({}); // stale patches get flushed on manual refresh
    await queryClient.invalidateQueries({ queryKey: ['games'] });
    setRefreshing(false);
  }, []);

  const handleGamePress = useCallback(
    (gameId: string) => {
      router.push(`/game/${gameId}` as any);
    },
    [router],
  );

  if (isLoading && games.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const renderSection = (
    title: string,
    data: GameDisplay[],
    emptyText: string | null,
  ) => {
    if (emptyText === null && data.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {data.length > 0 ? (
          <FlatList
            data={data}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.gameRow}
            renderItem={({ item }) => (
              <GameCard game={item} onPress={() => handleGamePress(item.id)} />
            )}
          />
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Game Day</Text>
        <Text style={styles.subtitle}>
          Today's action across every sport you follow
        </Text>
      </View>

      <View style={styles.pillRowContainer}>
        <SportPillRow
          pills={sportPills}
          activeId={activeSport}
          onSelect={setActiveSport}
        />
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
        {renderSection(
          '🔴 Live now',
          liveGames,
          'No games live right now — check back at kickoff time.',
        )}
        {renderSection(
          '🕐 Upcoming today',
          upcomingGames,
          'No more games today.',
        )}
        {/* Final today: hide entirely when empty (per v9.0 spec). */}
        {renderSection('✅ Final today', finalGames, null)}

        <View style={styles.spacer} />
      </ScrollView>
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
  pillRowContainer: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 10,
  },
  gameRow: {
    gap: 12,
    paddingVertical: 4,
  },
  emptyState: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    height: 40,
  },
});
