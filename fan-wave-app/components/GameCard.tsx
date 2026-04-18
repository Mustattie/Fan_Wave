import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';
import type { GameDisplay } from '@/lib/mappers';

interface GameCardProps {
  game: GameDisplay;
  onPress?: () => void;
}

export function GameCard({ game, onPress }: GameCardProps) {
  const isLive = game.status === 'live';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.teams}>
        <View style={styles.team}>
          <Text style={styles.teamEmoji}>{game.homeTeam.icon}</Text>
          <Text style={styles.teamName}>{game.homeTeam.name}</Text>
        </View>
        {isLive && game.homeScore != null && game.awayScore != null ? (
          <View style={styles.scoreContainer}>
            <Text style={styles.score}>{game.homeScore} - {game.awayScore}</Text>
            <View style={styles.liveBadge}>
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.vs}>VS</Text>
        )}
        <View style={styles.team}>
          <Text style={styles.teamEmoji}>{game.awayTeam.icon}</Text>
          <Text style={styles.teamName}>{game.awayTeam.name}</Text>
        </View>
      </View>
      <Text style={styles.time}>{game.time}</Text>
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
