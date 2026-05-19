import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Share,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { subscribeToTable } from '@/lib/realtime';

const GREEN = Colors.dark.accentGreen;
const GREEN_DARK = Colors.dark.accentGreenDark;

import { WC_EVENT_ID, WC_LEAGUE_ID } from '@/constants/WorldCupIds';
const TOURNAMENT_START = new Date('2026-06-11T00:00:00');

const FILTER_OPTIONS = [
  { id: 'all', label: 'All Matches' },
  { id: 'my_teams', label: 'My Teams' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
];

const STAGE_OPTIONS = [
  { id: 'all', label: 'All Stages' },
  { id: 'group', label: 'Group Stage' },
  { id: 'round_of_32', label: 'Round of 32' },
  { id: 'round_of_16', label: 'Round of 16' },
  { id: 'quarter_final', label: 'Quarter-Finals' },
  { id: 'semi_final', label: 'Semi-Finals' },
  { id: 'third_place', label: 'Third Place' },
  { id: 'final', label: 'Final' },
];

// ── Types ─────────────────────────────────────────────────
interface WCGameRow {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { name: string; code: string; colors: Record<string, string> } | null;
  away_team: { name: string; code: string; colors: Record<string, string> } | null;
  venue_name: string;
  scheduled_at: string;
  status: string;
  stage: string;
  home_score: number | null;
  away_score: number | null;
  metadata: Record<string, any>;
}

// ── Helpers ────────────────────────────────────────────────
function formatMatchDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatMatchTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSameDay(dateStr: string, today: Date): boolean {
  return getDateKey(dateStr) === getDateKey(today.toISOString());
}

function isFutureOrToday(dateStr: string, today: Date): boolean {
  return getDateKey(dateStr) >= getDateKey(today.toISOString());
}

function getDaysUntilTournament(): number {
  const now = new Date();
  const diff = TOURNAMENT_START.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getTeamFlag(team: WCGameRow['home_team']): string {
  return team?.colors?.flag || '🏳️';
}

function getTeamName(team: WCGameRow['home_team'], metadata: Record<string, any>, side: 'home' | 'away'): string {
  if (team) return team.name;
  return metadata?.[`${side}_placeholder`] || 'TBD';
}

function getTeamCode(team: WCGameRow['home_team']): string | null {
  return team?.code || null;
}

// ── Section data helpers ───────────────────────────────────
interface MatchSection {
  date: string;
  dateLabel: string;
  matches: WCGameRow[];
}

function groupMatchesByDate(matches: WCGameRow[]): MatchSection[] {
  const map = new Map<string, WCGameRow[]>();
  for (const m of matches) {
    const key = getDateKey(m.scheduled_at);
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, matches]) => ({
      date,
      dateLabel: formatMatchDate(matches[0].scheduled_at),
      matches,
    }));
}

type FlatItem =
  | { type: 'dateHeader'; date: string; dateLabel: string }
  | { type: 'match'; match: WCGameRow };

// ── Component ──────────────────────────────────────────────
export function WCSchedule() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeStage, setActiveStage] = useState('all');
  const [followedTeamIds, setFollowedTeamIds] = useState<Set<string>>(new Set());
  const [allGames, setAllGames] = useState<WCGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = useMemo(() => new Date(), []);
  const daysUntil = useMemo(() => getDaysUntilTournament(), []);
  const isTournamentStarted = daysUntil === 0;

  // Fetch WC games from Supabase
  const fetchGames = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          id, home_team_id, away_team_id,
          home_team:teams!games_home_team_id_fkey(name, code, colors),
          away_team:teams!games_away_team_id_fkey(name, code, colors),
          venue_name, scheduled_at, status, stage, home_score, away_score, metadata
        `)
        .eq('event_id', WC_EVENT_ID)
        .order('scheduled_at', { ascending: true });

      if (!error && data) {
        setAllGames(data as unknown as WCGameRow[]);
      }
    } catch {
      // Network error — keep existing data
    }
  }, []);

  // Fetch followed WC teams in a single query using inner join
  const fetchFollowedTeams = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_team_follows')
        .select('team_id, teams!inner(id, league_id)')
        .eq('user_id', user.id)
        .eq('teams.league_id', WC_LEAGUE_ID);

      if (!error && data) {
        setFollowedTeamIds(new Set(data.map((r: any) => r.team_id)));
      }
    } catch {
      // Ignore — follows just won't filter
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([fetchGames(), fetchFollowedTeams()]);
      setLoading(false);
    }
    init();
  }, [fetchGames, fetchFollowedTeams]);

  // Realtime: listen for game updates (score changes, status)
  useEffect(() => {
    const unsub = subscribeToTable(
      'wc-games-updates',
      'games',
      'UPDATE',
      (payload) => {
        const updated = payload.new as any;
        setAllGames((prev) =>
          prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)),
        );
      },
      `event_id=eq.${WC_EVENT_ID}`,
    );
    return unsub;
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchGames(), fetchFollowedTeams()]);
    setRefreshing(false);
  }, [fetchGames, fetchFollowedTeams]);

  // Filter + stage logic
  const filteredMatches = useMemo(() => {
    let matches = activeStage === 'all'
      ? [...allGames]
      : allGames.filter((g) => g.stage === activeStage);

    switch (activeFilter) {
      case 'my_teams':
        if (followedTeamIds.size === 0) return [];
        matches = matches.filter(
          (m) =>
            (m.home_team_id && followedTeamIds.has(m.home_team_id)) ||
            (m.away_team_id && followedTeamIds.has(m.away_team_id)),
        );
        break;
      case 'today':
        matches = matches.filter((m) => isSameDay(m.scheduled_at, today));
        break;
      case 'upcoming':
        matches = matches.filter((m) => isFutureOrToday(m.scheduled_at, today));
        break;
    }

    return matches;
  }, [activeFilter, activeStage, followedTeamIds, allGames, today]);

  // Build flat list data with date section headers
  const flatData: FlatItem[] = useMemo(() => {
    const sections = groupMatchesByDate(filteredMatches);
    const items: FlatItem[] = [];
    for (const section of sections) {
      items.push({ type: 'dateHeader', date: section.date, dateLabel: section.dateLabel });
      for (const match of section.matches) {
        items.push({ type: 'match', match });
      }
    }
    return items;
  }, [filteredMatches]);

  // ── Renderers ────────────────────────────────────────────

  const renderFilterBar = () => (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {FILTER_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.id}
            style={[styles.pill, activeFilter === opt.id && styles.pillActive]}
            onPress={() => setActiveFilter(opt.id)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pillText,
                activeFilter === opt.id && styles.pillTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderStageSelector = () => (
    <View style={styles.stageBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {STAGE_OPTIONS.map((stage) => (
          <TouchableOpacity
            key={stage.id}
            style={[styles.stagePill, activeStage === stage.id && styles.stagePillActive]}
            onPress={() => setActiveStage(stage.id)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.stagePillText,
                activeStage === stage.id && styles.stagePillTextActive,
              ]}
            >
              {stage.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderDateHeader = (dateLabel: string) => (
    <View style={styles.dateHeader}>
      <Text style={styles.dateHeaderText}>{dateLabel}</Text>
    </View>
  );

  const renderMatchCard = (match: WCGameRow) => {
    const homeFlag = getTeamFlag(match.home_team);
    const awayFlag = getTeamFlag(match.away_team);
    const homeName = getTeamName(match.home_team, match.metadata, 'home');
    const awayName = getTeamName(match.away_team, match.metadata, 'away');
    const group = match.metadata?.group;
    // ESPN sync writes status='in' for live games; accept either form.
    const isLive = match.status === 'live' || match.status === 'in';
    const isFinal = match.status === 'final' || match.status === 'post';
    // Soccer live extras stored on the metadata column by the ESPN function.
    const period = typeof match.metadata?.period === 'number' ? match.metadata.period : null;
    const clock = typeof match.metadata?.display_clock === 'string' ? match.metadata.display_clock : null;
    const periodLabel = period != null
      ? (clock ? `${period === 1 ? '1st' : period === 2 ? '2nd' : `${period}'`} · ${clock}` : period === 1 ? '1st half' : period === 2 ? '2nd half' : `${period}'`)
      : null;

    return (
      <View style={[styles.matchCard, isLive && styles.matchCardLive]}>
        {/* Stage + group badge row */}
        <View style={styles.matchMeta}>
          <Text style={styles.matchStage}>{match.stage.replace(/_/g, ' ')}</Text>
          {group && (
            <View style={styles.groupBadge}>
              <Text style={styles.groupBadgeText}>Group {group}</Text>
            </View>
          )}
          {isLive && (
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{periodLabel ? `LIVE · ${periodLabel}` : 'LIVE'}</Text>
            </View>
          )}
          {!isLive && isFinal && (
            <View style={styles.liveIndicator}>
              <Text style={styles.liveText}>FINAL</Text>
            </View>
          )}
        </View>

        {/* Teams row */}
        <View style={styles.teamsRow}>
          <View style={styles.teamSide}>
            <Text style={styles.teamFlag}>{homeFlag}</Text>
            <Text style={styles.teamName} numberOfLines={1}>
              {homeName}
            </Text>
          </View>

          <View style={styles.scoreCenter}>
            {match.home_score != null && match.away_score != null ? (
              <Text style={isLive ? styles.scoreTextLive : styles.scoreText}>
                {match.home_score} - {match.away_score}
              </Text>
            ) : (
              <Text style={styles.vsText}>VS</Text>
            )}
          </View>

          <View style={[styles.teamSide, styles.teamSideRight]}>
            <Text style={styles.teamFlag}>{awayFlag}</Text>
            <Text style={styles.teamName} numberOfLines={1}>
              {awayName}
            </Text>
          </View>
        </View>

        {/* Venue + time + share */}
        <View style={styles.matchFooter}>
          <View style={{ flex: 1 }}>
            <Text style={styles.venueText} numberOfLines={1}>
              {match.venue_name || 'TBD'}{match.metadata?.venue_city ? `, ${match.metadata.venue_city}` : ''}
            </Text>
            <Text style={styles.timeText}>
              {formatMatchDate(match.scheduled_at)} {'\u00B7'} {formatMatchTime(match.scheduled_at)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.matchShareBtn}
            onPress={() => {
              const score = match.home_score != null ? `${match.home_score}-${match.away_score}` : 'upcoming';
              Share.share({
                message: `${homeName} vs ${awayName} (${score})\n${match.venue_name || 'TBD'} · ${formatMatchDate(match.scheduled_at)}\n\nFollow on Fan Wave!`,
              });
            }}
          >
            <Text style={styles.matchShareText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderItem = useCallback(
    ({ item }: { item: FlatItem }) => {
      if (item.type === 'dateHeader') {
        return renderDateHeader(item.dateLabel);
      }
      return renderMatchCard(item.match);
    },
    [followedTeamIds, allGames],
  );

  const keyExtractor = useCallback((item: FlatItem, index: number) => {
    if (item.type === 'dateHeader') return `date-${item.date}`;
    return item.match.id;
  }, []);

  // ── Empty / Countdown / Loading states ──────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  const renderCountdown = () => (
    <View style={styles.countdownContainer}>
      <Text style={styles.countdownEmoji}>{'\u26BD'}</Text>
      <Text style={styles.countdownTitle}>FIFA World Cup 2026</Text>
      <View style={styles.countdownBadge}>
        <Text style={styles.countdownNumber}>{daysUntil}</Text>
        <Text style={styles.countdownLabel}>days to go</Text>
      </View>
      <Text style={styles.countdownDate}>
        Kicks off June 11, 2026
      </Text>
    </View>
  );

  const renderEmptyMyTeams = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>{'\u2B50'}</Text>
      <Text style={styles.emptyTitle}>No teams followed yet</Text>
      <Text style={styles.emptySubtitle}>
        Follow your favorite national teams to see their matches here
      </Text>
    </View>
  );

  const renderEmptyList = () => {
    if (activeFilter === 'my_teams' && followedTeamIds.size === 0) {
      return renderEmptyMyTeams();
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No matches found</Text>
        <Text style={styles.emptySubtitle}>
          Try changing the filter or stage selection
        </Text>
      </View>
    );
  };

  // ── Main render ──────────────────────────────────────────

  return (
    <View style={styles.container}>
      {renderFilterBar()}
      {renderStageSelector()}

      <FlatList
        data={flatData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          !isTournamentStarted && activeFilter === 'all' && flatData.length > 0
            ? renderCountdown
            : undefined
        }
        ListEmptyComponent={renderEmptyList}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={GREEN}
            colors={[GREEN]}
            progressBackgroundColor={Colors.dark.surface}
          />
        }
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

  // Filter bar
  filterBar: {
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 16,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  pillActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  pillTextActive: {
    color: '#ffffff',
  },

  // Stage selector
  stageBar: {
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  stagePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  stagePillActive: {
    backgroundColor: GREEN_DARK,
    borderColor: GREEN,
  },
  stagePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  stagePillTextActive: {
    color: GREEN,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },

  // Date headers
  dateHeader: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  dateHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    letterSpacing: 0.5,
  },

  // Match card
  matchCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  matchCardLive: {
    borderColor: GREEN,
    borderWidth: 1.5,
  },
  matchMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  matchStage: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.textMuted,
  },
  groupBadge: {
    backgroundColor: GREEN_DARK,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  groupBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: GREEN,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '800',
    color: GREEN,
  },

  // Teams row
  teamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  teamSide: {
    flex: 1,
    alignItems: 'center',
  },
  teamSideRight: {
    // Mirror alignment
  },
  teamFlag: {
    fontSize: 32,
    marginBottom: 4,
  },
  teamName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  scoreCenter: {
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  vsText: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.dark.textMuted,
  },
  scoreText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  scoreTextLive: {
    fontSize: 20,
    fontWeight: '800',
    color: GREEN,
  },

  // Footer
  matchFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchShareBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: `${GREEN}22`,
  },
  matchShareText: {
    fontSize: 11,
    fontWeight: '700',
    color: GREEN,
  },
  venueText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  timeText: {
    fontSize: 11,
    color: Colors.dark.textMuted,
  },

  // Countdown
  countdownContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  countdownEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  countdownTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
    marginBottom: 16,
  },
  countdownBadge: {
    backgroundColor: GREEN_DARK,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: GREEN,
  },
  countdownNumber: {
    fontSize: 36,
    fontWeight: '900',
    color: GREEN,
  },
  countdownLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  countdownDate: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 20,
  },

  // Empty states
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
