import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import type { TeamDisplay } from '@/lib/mappers';

interface Props {
  team: TeamDisplay;
  size?: number;
}

// Logo first; if missing or fails to load, fall back to a colored circle
// using the team's seeded primary color + 3-letter code; if neither exists,
// the sport emoji.
export function TeamBadge({ team, size = 40 }: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const hasLogo = Boolean(team.logoUrl) && !logoFailed;

  if (hasLogo) {
    // White circular frame so dark-on-transparent logos (Yankees navy "NY",
    // Brooklyn Nets black, etc.) have contrast against the dark surface.
    // Inner image is sized down so it doesn't touch the circle edge.
    return (
      <View
        style={[
          styles.logoFrame,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Image
          source={{ uri: team.logoUrl! }}
          style={{ width: size * 0.82, height: size * 0.82 }}
          resizeMode="contain"
          onError={() => setLogoFailed(true)}
          accessibilityLabel={team.name}
        />
      </View>
    );
  }

  if (team.code) {
    const bg = team.primaryColor ?? Colors.dark.surface;
    const fontSize = Math.round(size * 0.32);
    return (
      <View
        style={[
          styles.codeBadge,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        ]}
      >
        <Text style={[styles.codeText, { fontSize }]} numberOfLines={1}>
          {team.code}
        </Text>
      </View>
    );
  }

  return (
    <Text style={[styles.emoji, { fontSize: Math.round(size * 0.7) }]}>{team.icon}</Text>
  );
}

const styles = StyleSheet.create({
  logoFrame: {
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBadge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeText: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  emoji: {},
});
