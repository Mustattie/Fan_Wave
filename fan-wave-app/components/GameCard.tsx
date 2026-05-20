import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';
import type { GameDisplay } from '@/lib/mappers';

interface GameCardProps {
  game: GameDisplay;
  onPress?: () => void;
}

function formatPeriodLabel(
  sport: string,
  period: number | null | undefined,
  clock: string | null | undefined,
  detail: string | null | undefined,
): string | null {
  const s = sport?.toLowerCase() || '';
  // For sports with no game clock (baseball), ESPN reports clock as "0:00"
  // and the meaningful state lives in `detail` ("Top 2nd", "Bottom 5th",
  // "End of 3rd Inning"). Use detail directly if available.
  if (s === 'mlb' || s === 'baseball') {
    if (detail) return detail;
    if (period != null) return `Inn ${period}`;
    return null;
  }
  if (period == null) return detail || null;
  let periodLabel: string;
  if (s === 'soccer' || s === 'mls' || s === 'worldcup') {
    periodLabel = period === 1 ? '1st' : period === 2 ? '2nd' : `${period}'`;
  } else if (s === 'nhl' || s === 'hockey') {
    periodLabel = period > 3 ? `OT${period - 3}` : `P${period}`;
  } else {
    // NFL / NBA / college etc — quarters
    periodLabel = period > 4 ? `OT${period - 4}` : `Q${period}`;
  }
  // For clock-bearing sports, "0:00" is end-of-period, not useful as a
  // running label — fall back to plain period.
  if (clock && clock !== '0:00') return `${periodLabel} · ${clock}`;
  return periodLabel;
}

export function GameCard({ game, onPress }: GameCardProps) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const hasScore = game.homeScore != null && game.awayScore != null;
  const periodLabel = formatPeriodLabel(game.sport, game.period, game.displayClock, game.detail);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.teams}>
        <View style={styles.team}>
          <Text style={styles.teamEmoji}>{game.homeTeam.icon}</Text>
          <Text style={styles.teamName}>{game.homeTeam.name}</Text>
        </View>
        {(isLive || isFinal) && hasScore ? (
          <View style={styles.scoreContainer}>
            <Text style={styles.score}>{game.homeScore} - {game.awayScore}</Text>
            {isLive ? (
              <View style={styles.liveBadge}>
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            ) : (
              <View style={styles.finalBadge}>
                <Text style={styles.finalText}>FINAL</Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.vs}>VS</Text>
        )}
        <View style={styles.team}>
          <Text style={styles.teamEmoji}>{game.awayTeam.icon}</Text>
          <Text style={styles.teamName}>{game.awayTeam.name}</Text>
        </View>
      </View>
      {isLive && periodLabel ? (
        <Text style={styles.periodLabel}>{periodLabel}</Text>
      ) : (
        <Text style={styles.time}>{game.time}</Text>
      )}
      <Text style={styles.league}>{game.league}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 200,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  teams: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  team: {
    alignItems: 'center',
  },
  teamEmoji: {
    fontSize: 28,
  },
  teamName: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  vs: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    fontWeight: '700',
  },
  scoreContainer: {
    alignItems: 'center',
  },
  score: {
    fontSize: 16,
    color: Colors.dark.text,
    fontWeight: '800',
  },
  liveBadge: {
    backgroundColor: Colors.dark.error,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  liveText: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '800',
  },
  finalBadge: {
    backgroundColor: Colors.dark.textMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  finalText: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '800',
  },
  periodLabel: {
    fontSize: 11,
    color: Colors.dark.error,
    fontWeight: '700',
    textAlign: 'center',
  },
  time: {
    fontSize: 12,
    color: Colors.dark.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
  league: {
    fontSize: 10,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
});
