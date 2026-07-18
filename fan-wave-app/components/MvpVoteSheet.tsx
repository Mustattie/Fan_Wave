import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { X, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import { TeamBadge } from '@/components/TeamBadge';
import type { TeamDisplay } from '@/lib/mappers';

interface Props {
  visible: boolean;
  onClose: () => void;
  gameId: string | null;
  homeTeam: TeamDisplay;
  awayTeam: TeamDisplay;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

interface Tally {
  homeVotes: number;
  awayVotes: number;
  myVote: string | null;
}

const C = Colors.dark;

export function MvpVoteSheet({
  visible,
  onClose,
  gameId,
  homeTeam,
  awayTeam,
  homeTeamId,
  awayTeamId,
}: Props) {
  const [tally, setTally] = useState<Tally>({ homeVotes: 0, awayVotes: 0, myVote: null });
  const [loading, setLoading] = useState(false);
  const [castingFor, setCastingFor] = useState<string | null>(null);
  // v9.1 UAT: "when one votes they submit vote not X out like here."
  // Pending selection now decouples "which team the user has picked in
  // this session" from "vote already recorded on the server." Tapping a
  // team just highlights it; the Submit button commits.
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);

  const loadTally = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_mvp_tally', { p_game_id: id });
      if (error) {
        reportError(error, { source: 'MvpVoteSheet:tally', gameId: id });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setTally({
          homeVotes: Number(row.home_votes ?? 0),
          awayVotes: Number(row.away_votes ?? 0),
          myVote: row.my_vote ?? null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && gameId) {
      loadTally(gameId);
    } else {
      setTally({ homeVotes: 0, awayVotes: 0, myVote: null });
      setPendingSelection(null);
    }
  }, [visible, gameId, loadTally]);

  // Seed the pending selection from the server's current vote whenever
  // the tally reloads, so the Submit button reads "Update vote" for
  // returning users and "Submit vote" for first-timers.
  useEffect(() => {
    setPendingSelection(tally.myVote);
  }, [tally.myVote]);

  const submitVote = async () => {
    if (!gameId || !pendingSelection || castingFor) return;
    // No-op if the user hits Submit without changing their prior pick.
    if (pendingSelection === tally.myVote) {
      onClose();
      return;
    }
    setCastingFor(pendingSelection);
    const prev = tally;
    // Optimistic shift so the bar animates immediately.
    setTally((t) => {
      const wasHome = t.myVote === homeTeamId;
      const wasAway = t.myVote === awayTeamId;
      const home = t.homeVotes - (wasHome ? 1 : 0) + (pendingSelection === homeTeamId ? 1 : 0);
      const away = t.awayVotes - (wasAway ? 1 : 0) + (pendingSelection === awayTeamId ? 1 : 0);
      return { homeVotes: Math.max(0, home), awayVotes: Math.max(0, away), myVote: pendingSelection };
    });
    try {
      const { error } = await supabase.rpc('cast_mvp_vote', {
        p_game_id: gameId,
        p_team_id: pendingSelection,
      });
      if (error) {
        setTally(prev);
        reportError(error, { source: 'MvpVoteSheet:cast', gameId, teamId: pendingSelection });
        Alert.alert('Vote failed', error.message);
        return;
      }
      await loadTally(gameId);
      onClose();
    } finally {
      setCastingFor(null);
    }
  };

  const total = tally.homeVotes + tally.awayVotes;
  const homePct = total > 0 ? Math.round((tally.homeVotes / total) * 100) : 50;
  const awayPct = total > 0 ? 100 - homePct : 50;

  const renderCard = (
    side: 'home' | 'away',
    team: TeamDisplay,
    teamId: string | null,
    votes: number,
    pct: number,
  ) => {
    const isConfirmed = tally.myVote != null && tally.myVote === teamId;
    const isPending = pendingSelection != null && pendingSelection === teamId && !isConfirmed;
    const highlight = isConfirmed || isPending;
    const busy = castingFor === teamId;
    return (
      <TouchableOpacity
        style={[styles.teamCard, highlight && styles.teamCardSelected]}
        activeOpacity={0.85}
        onPress={() => teamId && setPendingSelection(teamId)}
        disabled={!teamId || !!castingFor}
      >
        <TeamBadge team={team} size={64} />
        <Text style={styles.teamName} numberOfLines={1}>
          {team.name}
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={C.accent} style={{ marginTop: 4 }} />
        ) : (
          <>
            <Text style={styles.teamPct}>{pct}%</Text>
            <Text style={styles.teamVotes}>
              {votes} {votes === 1 ? 'vote' : 'votes'}
            </Text>
          </>
        )}
        {isConfirmed && (
          <View style={styles.selectedBadge}>
            <Text style={styles.selectedBadgeText}>Your pick</Text>
          </View>
        )}
        {isPending && (
          <View style={[styles.selectedBadge, styles.pendingBadge]}>
            <Text style={styles.selectedBadgeText}>Selected</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Trophy size={18} color={C.accent} />
              <Text style={styles.title}>Fan MVP</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <X size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Which side had the standout player? You can change your pick anytime.
          </Text>

          {loading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <>
              <View style={styles.teamsRow}>
                {renderCard('home', homeTeam, homeTeamId, tally.homeVotes, homePct)}
                {renderCard('away', awayTeam, awayTeamId, tally.awayVotes, awayPct)}
              </View>

              <View style={styles.barTrack}>
                <View style={[styles.barHomeFill, { flex: Math.max(homePct, 1) }]} />
                <View style={[styles.barAwayFill, { flex: Math.max(awayPct, 1) }]} />
              </View>
              <Text style={styles.totalLine}>
                {total === 0
                  ? 'No votes yet — be the first.'
                  : `${total} ${total === 1 ? 'fan has' : 'fans have'} voted`}
              </Text>

              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  (!pendingSelection || !!castingFor || pendingSelection === tally.myVote) &&
                    styles.submitBtnDisabled,
                ]}
                onPress={submitVote}
                disabled={!pendingSelection || !!castingFor || pendingSelection === tally.myVote}
                activeOpacity={0.85}
              >
                {castingFor ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {tally.myVote ? 'Update vote' : 'Submit vote'}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  loadingBlock: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  teamsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
  },
  teamCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: C.border,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 6,
  },
  teamCardSelected: {
    borderColor: C.accent,
    backgroundColor: `${C.accent}12`,
  },
  teamName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    maxWidth: '90%',
    textAlign: 'center',
  },
  teamPct: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  teamVotes: {
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  selectedBadge: {
    marginTop: 6,
    backgroundColor: C.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pendingBadge: {
    backgroundColor: `${C.accent}55`,
  },
  selectedBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  submitBtn: {
    marginHorizontal: 18,
    marginTop: 16,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  barTrack: {
    flexDirection: 'row',
    height: 8,
    marginHorizontal: 18,
    marginTop: 16,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  barHomeFill: {
    backgroundColor: C.accent,
  },
  barAwayFill: {
    backgroundColor: C.textMuted,
  },
  totalLine: {
    color: C.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
});
