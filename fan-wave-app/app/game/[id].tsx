import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MapPin, Users, Film, MessageCircle, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { TeamBadge } from '@/components/TeamBadge';
import {
  mapGameToDisplay,
  mapWatchPartyToDisplay,
  mapClipToDisplay,
  getSportEmoji,
  getSportColor,
  type GameDisplay,
  type WatchPartyDisplay,
  type ClipDisplay,
} from '@/lib/mappers';
import { subscribeToGames } from '@/lib/realtime';

// Game detail — v9.0.1.
// Reached from Game Day tab (previously showed an Alert stub). Shows:
//   * Score / status header with live period label
//   * Watch Parties for this game (watch_parties.game_id FK)
//   * Clips for this game (media_clips.game_id FK)
//   * Fan Groups for either team (chat_rooms.team_id in [home, away])
//   * CTAs for live chat + MVP voting marked "Coming v9.1"
// Zero new schema — all joins already exist. v9.1 adds
// chat_rooms.game_id + mvp_votes and swaps the CTAs for real UI.

interface FanGroupRow {
  id: string;
  name: string;
  member_count: number | null;
  team_id: string | null;
  avatar_url?: string | null;
}

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [game, setGame] = useState<GameDisplay | null>(null);
  const [parties, setParties] = useState<WatchPartyDisplay[]>([]);
  const [clips, setClips] = useState<ClipDisplay[]>([]);
  const [groups, setGroups] = useState<FanGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    if (!id) return;

    // Fetch the game row + related teams. Same select shape as useGames so
    // mapGameToDisplay works unchanged.
    const gameRes = await supabase
      .from('games')
      .select(
        '*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)',
      )
      .eq('id', id)
      .maybeSingle();

    if (gameRes.error || !gameRes.data) {
      setGame(null);
      return;
    }

    const mappedGame = mapGameToDisplay(gameRes.data);
    setGame(mappedGame);

    const homeTeamId = gameRes.data.home_team_id;
    const awayTeamId = gameRes.data.away_team_id;

    // Related data — three parallel queries. Failures on any one leave the
    // section empty rather than breaking the whole screen.
    const [partyRes, clipRes, groupRes] = await Promise.all([
      supabase
        .from('watch_parties')
        .select('*, sport:sports!sport_id(*)')
        .eq('game_id', id)
        .order('starts_at', { ascending: true })
        .limit(20),
      supabase
        .from('media_clips')
        .select('*')
        .eq('game_id', id)
        .order('like_count', { ascending: false })
        .limit(20),
      homeTeamId || awayTeamId
        ? supabase
            .from('chat_rooms')
            .select('id, name, member_count, team_id, avatar_url')
            .in(
              'team_id',
              [homeTeamId, awayTeamId].filter(Boolean) as string[],
            )
            .eq('visibility', 'public')
            .order('member_count', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    setParties((partyRes.data ?? []).map(mapWatchPartyToDisplay));
    setClips((clipRes.data ?? []).map(mapClipToDisplay));
    setGroups(groupRes.data ?? []);
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll();
      setLoading(false);
    })();
  }, [loadAll]);

  // Live score patching — reuse the same subscribeToGames helper Game Day
  // uses so a live goal / score change hits the header without a manual
  // refresh.
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToGames((row) => {
      if (row.id !== id) return;
      try {
        // Refetch just the game row so we get freshly joined team names
        // instead of trying to patch the mapped shape client-side.
        supabase
          .from('games')
          .select(
            '*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)',
          )
          .eq('id', id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setGame(mapGameToDisplay(data));
          });
      } catch {
        /* ignore — user can pull-to-refresh */
      }
    });
    return () => {
      unsub();
    };
  }, [id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Text style={styles.notFoundTitle}>Game not found</Text>
          <Text style={styles.notFoundSubtitle}>
            This game may have been removed or the link is stale.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const hasScore = game.homeScore != null && game.awayScore != null;
  const sportColor = getSportColor(game.sport);
  const sportEmoji = getSportEmoji(game.sport);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {game.league || 'Game'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.dark.accent}
          />
        }
      >
        <View style={[styles.hero, { borderColor: sportColor + '55' }]}>
          <View style={styles.sportPill}>
            <Text style={styles.sportPillText}>
              {sportEmoji} {(game.sport || 'sport').toUpperCase()}
            </Text>
          </View>

          <View style={styles.teamsRow}>
            <View style={styles.teamCol}>
              <TeamBadge team={game.homeTeam} size={72} />
              <Text style={styles.teamName} numberOfLines={1}>
                {game.homeTeam.name}
              </Text>
              {game.homeTeam.code ? (
                <Text style={styles.teamCode}>{game.homeTeam.code}</Text>
              ) : null}
            </View>

            <View style={styles.scoreCol}>
              {(isLive || isFinal) && hasScore ? (
                <>
                  <Text style={styles.scoreText}>
                    {game.homeScore} - {game.awayScore}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      isLive ? styles.liveBadge : styles.finalBadge,
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>
                      {isLive ? 'LIVE' : 'FINAL'}
                    </Text>
                  </View>
                  {isLive && (game.detail || game.displayClock) ? (
                    <Text style={styles.periodText}>
                      {game.detail || game.displayClock}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.vsText}>VS</Text>
                  <Text style={styles.kickoffText}>{game.time}</Text>
                </>
              )}
            </View>

            <View style={styles.teamCol}>
              <TeamBadge team={game.awayTeam} size={72} />
              <Text style={styles.teamName} numberOfLines={1}>
                {game.awayTeam.name}
              </Text>
              {game.awayTeam.code ? (
                <Text style={styles.teamCode}>{game.awayTeam.code}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.cta, styles.ctaDisabled]}
            disabled
            activeOpacity={0.7}
          >
            <MessageCircle size={18} color={Colors.dark.textSecondary} />
            <Text style={styles.ctaText}>Live chat</Text>
            <Text style={styles.ctaBadge}>v9.1</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cta, styles.ctaDisabled]}
            disabled
            activeOpacity={0.7}
          >
            <Trophy size={18} color={Colors.dark.textSecondary} />
            <Text style={styles.ctaText}>MVP vote</Text>
            <Text style={styles.ctaBadge}>v9.1</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Watch Parties</Text>
            <TouchableOpacity
              onPress={() => router.push({
                pathname: '/create-watch-party',
                params: { gameId: game.id },
              })}
            >
              <Text style={styles.sectionAction}>+ Host</Text>
            </TouchableOpacity>
          </View>
          {parties.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No watch parties for this game yet.
              </Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/create-watch-party',
                    params: { gameId: game.id },
                  })
                }
                style={styles.emptyAction}
              >
                <Text style={styles.emptyActionText}>Host one →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            parties.map((party) => (
              <TouchableOpacity
                key={party.id}
                style={styles.rowCard}
                onPress={() => router.push(`/watch-party/${party.id}` as any)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: party.sportColor + '33' },
                  ]}
                >
                  <Text style={styles.rowIconText}>{party.sportIcon}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {party.title}
                  </Text>
                  <View style={styles.rowMeta}>
                    <MapPin size={12} color={Colors.dark.textSecondary} />
                    <Text style={styles.rowMetaText} numberOfLines={1}>
                      {party.venue} · {party.venueArea || 'TBD'}
                    </Text>
                  </View>
                  <Text style={styles.rowMetaText}>{party.date}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Users size={12} color={Colors.dark.textSecondary} />
                  <Text style={styles.rowRightText}>{party.rsvpCount}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Clips</Text>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/create-clip',
                  params: { gameId: game.id },
                })
              }
            >
              <Text style={styles.sectionAction}>+ Upload</Text>
            </TouchableOpacity>
          </View>
          {clips.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No clips yet. Be the first to share a moment.
              </Text>
            </View>
          ) : (
            <FlatList
              data={clips}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.clipRow}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.clipCard}
                  onPress={() => router.push('/(tabs)/clips')}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.clipPoster,
                      { backgroundColor: item.bgColors?.[0] || Colors.dark.surface },
                    ]}
                  >
                    <Film size={22} color="#fff" />
                  </View>
                  <Text style={styles.clipTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.clipMeta}>
                    {item.poster} · {item.like_count} ♥
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fan Groups</Text>
          {groups.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No public fan groups for these teams yet.
              </Text>
            </View>
          ) : (
            groups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={styles.rowCard}
                onPress={() => router.push(`/fan-group/${group.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={styles.groupBadge}>
                  <Text style={styles.groupBadgeText}>
                    {(group.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Users size={12} color={Colors.dark.textSecondary} />
                    <Text style={styles.rowMetaText}>
                      {group.member_count ?? 0} members
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  hero: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sportPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  sportPillText: {
    color: Colors.dark.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  teamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  teamName: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  teamCode: {
    color: Colors.dark.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  scoreCol: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
    minWidth: 100,
  },
  scoreText: {
    color: Colors.dark.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
  },
  vsText: {
    color: Colors.dark.textSecondary,
    fontSize: 18,
    fontWeight: '800',
  },
  kickoffText: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  liveBadge: {
    backgroundColor: Colors.dark.error,
  },
  finalBadge: {
    backgroundColor: Colors.dark.textMuted,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  periodText: {
    color: Colors.dark.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
  ctaBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.accent,
    backgroundColor: Colors.dark.accent + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionAction: {
    color: Colors.dark.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: 4,
  },
  emptyActionText: {
    color: Colors.dark.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: {
    fontSize: 22,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowMetaText: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  rowRight: {
    alignItems: 'center',
    gap: 2,
  },
  rowRightText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '700',
  },
  clipRow: {
    gap: 12,
    paddingVertical: 4,
  },
  clipCard: {
    width: 140,
    gap: 6,
  },
  clipPoster: {
    width: 140,
    height: 90,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipTitle: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '600',
  },
  clipMeta: {
    color: Colors.dark.textSecondary,
    fontSize: 11,
  },
  groupBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupBadgeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  notFoundTitle: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  notFoundSubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
});
