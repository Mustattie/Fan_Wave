// Post-onboarding sport-follow editor.
//
// v9.4.0 UAT Round 3 (#21): tapping "My Sports" in Profile used to route
// to /(auth)/onboarding-sports, which then hit its "if already onboarded,
// bounce to /(tabs)" guard (onboarding-sports.tsx:26-42) and dumped the
// user back on Home. UAT read that as "the button routes to Home."
//
// This screen is the persistent editor: same picker UI, no onboarding
// guard, saves to AsyncStorage 'selected_sports' immediately on toggle
// (matches how Home + Game Day read the source of truth). Also fires an
// invalidation on any react-query surface that reads the sport list.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SPORTS } from '@/constants/Sports';
import { Colors } from '@/constants/Colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryClient } from '@/hooks/useQueryClient';
import {
  SELECTED_SPORTS_KEY,
  loadInterestSportSources,
} from '@/lib/interestSports';

type SportItem = (typeof SPORTS)[number];

const GRID_COLUMNS = 3;

// SKYC-140: the grid is numColumns={3} over cards with flex:1 inside a
// `justifyContent: 'space-between'` row, and SPORTS is 8 long -- so the
// final row held 2 cards that each stretched to half the width, twice the
// size of every card above them, reading as a layout bug rather than a
// short row. FlatList has no notion of a partial row; padding the data to
// a whole number of rows with inert cells is the standard fix.
export type SportGridCell =
  | { kind: 'sport'; key: string; sport: SportItem }
  | { kind: 'filler'; key: string };

export function padSportsForGrid(
  sports: readonly SportItem[],
  columns: number = GRID_COLUMNS,
): SportGridCell[] {
  const cells: SportGridCell[] = sports.map((sport) => ({
    kind: 'sport',
    key: sport.id,
    sport,
  }));
  if (columns < 2) return cells;
  const remainder = cells.length % columns;
  if (remainder === 0) return cells;
  for (let i = remainder; i < columns; i++) {
    cells.push({ kind: 'filler', key: `filler-${i}` });
  }
  return cells;
}

// A followed-team sport arrives as get_user_teams names it, which is not
// guaranteed to be one of our sport ids. Compare on a squashed form so
// 'NFL' and 'nfl' meet, and leave genuinely unmatched tokens alone rather
// than guessing which card they belong to.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchFollowedToGrid(
  followed: Set<string>,
  sports: readonly SportItem[] = SPORTS,
): { gridIds: Set<string>; unmatched: string[] } {
  const byToken = new Map<string, string>();
  for (const s of sports) {
    byToken.set(squash(s.id), s.id);
    byToken.set(squash(s.name), s.id);
  }
  const gridIds = new Set<string>();
  const unmatched: string[] = [];
  for (const token of followed) {
    const hit = byToken.get(squash(token));
    if (hit) gridIds.add(hit);
    else unmatched.push(token);
  }
  return { gridIds, unmatched: unmatched.sort() };
}

export default function MySportsScreen() {
  const router = useRouter();
  // The user's own picks -- the only half of the interest set that is
  // editable here. Deselection semantics are unchanged by SKYC-139:
  // tapping a picked card removes it from this set and from storage.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Sports the user reaches through a followed team. Read-only here:
  // they come off the list by unfollowing the team, not by tapping.
  const [followedGridIds, setFollowedGridIds] = useState<Set<string>>(new Set());
  const [followedUnmatched, setFollowedUnmatched] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Explains the one tap whose visible result is "still highlighted":
  // removing a pick that a followed team also supplies.
  const [notice, setNotice] = useState<string | null>(null);

  // Hydrate from the same reader Home + Game Day filter on, so this
  // screen shows the whole interest set instead of half of it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { picks, followed } = await loadInterestSportSources();
        if (cancelled) return;
        setSelected(picks);
        const { gridIds, unmatched } = matchFollowedToGrid(followed);
        setFollowedGridIds(gridIds);
        setFollowedUnmatched(unmatched);
      } catch {
        if (!cancelled) setSelected(new Set());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSelection = useCallback(async (next: Set<string>) => {
    setSaving(true);
    try {
      await AsyncStorage.setItem(SELECTED_SPORTS_KEY, JSON.stringify([...next]));
      // Nudge any read side (Home Today's Games, Game Day filter) so the
      // new interest list is respected without a manual pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['games'] });
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleSport = useCallback(
    (id: string) => {
      // Computed outside the state updater: the updater has to stay pure
      // (React may call it twice), and the persist + notice below are
      // side effects.
      const wasPicked = selected.has(id);
      const next = new Set(selected);
      if (wasPicked) next.delete(id);
      else next.add(id);
      setSelected(next);
      // Honest feedback for the one tap whose card does not go dark: a
      // followed team keeps the sport in the feed, and only unfollowing
      // the team changes that.
      const label = SPORTS.find((s) => s.id === id)?.name ?? id;
      setNotice(
        wasPicked && followedGridIds.has(id)
          ? `Removed ${label} from your picks. It still appears in your feeds because you follow a team in it — unfollow the team to drop it.`
          : null,
      );
      void persistSelection(next);
    },
    [selected, followedGridIds, persistSelection],
  );

  const gridData = useMemo(() => padSportsForGrid(SPORTS, GRID_COLUMNS), []);

  // Sports in the feed only because of a followed team.
  const derivedOnlyCount = useMemo(() => {
    let n = followedUnmatched.length;
    for (const id of followedGridIds) if (!selected.has(id)) n++;
    return n;
  }, [followedGridIds, followedUnmatched, selected]);

  const renderItem = ({ item }: { item: SportGridCell }) => {
    if (item.kind === 'filler') {
      // Holds the column so the last row's real cards keep the width of
      // every other row. Inert: no touch target, nothing announced.
      return (
        <View
          style={[styles.card, styles.cardFiller]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      );
    }
    const sport = item.sport;
    const isPicked = selected.has(sport.id);
    const isFollowed = followedGridIds.has(sport.id);
    return (
      <TouchableOpacity
        style={[
          styles.card,
          isPicked && styles.cardSelected,
          !isPicked && isFollowed && styles.cardFollowed,
        ]}
        activeOpacity={0.7}
        onPress={() => toggleSport(sport.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: isPicked }}
        accessibilityLabel={
          isPicked
            ? `${sport.name}, following`
            : isFollowed
              ? `${sport.name}, in your feed from a team you follow`
              : `${sport.name}, not following`
        }
      >
        <Text style={styles.emoji}>{sport.icon}</Text>
        <Text style={styles.sportName}>{sport.name}</Text>
        {/* Two different states, two different looks. A sport that is in
            the feed because of a team follow is not a pick and cannot be
            tapped off, so it must not look identical to one that can. */}
        {!isPicked && isFollowed ? (
          <Text style={styles.viaTeams} numberOfLines={1}>
            via your teams
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Sports</Text>
        <Text style={styles.subtitle}>
          Tap to add or remove. Your Home + Game Day feeds update instantly.
        </Text>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <FlatList
        data={gridData}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        numColumns={GRID_COLUMNS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.bottom}>
        {/* SKYC-139: "N following" counted the device picks only, which
            is not what the feeds filter on. Report both halves. */}
        <Text style={styles.countText}>
          {selected.size + derivedOnlyCount} following
          {derivedOnlyCount > 0
            ? ` · ${derivedOnlyCount} from teams you follow`
            : ''}
          {saving ? ' · saving…' : ''}
        </Text>
        {followedUnmatched.length > 0 ? (
          // Named rather than silently counted: these come from followed
          // teams in sports with no card on this grid, so there is
          // nothing here to highlight for them.
          <Text style={styles.countSubText}>
            Also in your feeds from teams you follow:{' '}
            {followedUnmatched.join(', ')}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: 8 },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: Colors.dark.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.dark.textSecondary },
  grid: { paddingHorizontal: 24 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  card: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accent + '22' },
  // Team-derived: present in the feed, but not a pick and not tappable
  // off. Dashed + dimmer than a pick so the two never read as one state.
  cardFollowed: {
    borderColor: Colors.dark.accent + '77',
    borderStyle: 'dashed',
    backgroundColor: Colors.dark.accent + '0d',
  },
  cardFiller: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  emoji: { fontSize: 32, marginBottom: 4 },
  sportName: { color: Colors.dark.text, fontSize: 12, fontWeight: '500' },
  viaTeams: {
    color: Colors.dark.textMuted,
    fontSize: 9,
    marginTop: 2,
    paddingHorizontal: 4,
  },
  notice: {
    marginHorizontal: 24,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  noticeText: { color: Colors.dark.textSecondary, fontSize: 12, lineHeight: 17 },
  bottom: { padding: 24, alignItems: 'center' },
  countText: { color: Colors.dark.textSecondary, fontSize: 13 },
  countSubText: {
    color: Colors.dark.textMuted,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
