import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Colors } from '@/constants/Colors';
import type { TeamDisplay } from '@/lib/mappers';

interface Props {
  team: TeamDisplay;
  size?: number;
}

// Logo first; if missing or fails to load, fall back to a colored circle
// using the team's seeded primary color + 3-letter code; if neither exists,
// the sport emoji.
//
// SKYC-138 (2026-10-20): this used to be core RN <Image> with no key of any
// kind. Both Home and Game Day render their cards in horizontal FlatLists, so
// a badge instance gets handed a different team as the list re-renders -- and
// core <Image> keeps the previously decoded bitmap on screen until the new URI
// resolves. That makes one team wearing another team's logo possible for as
// long as the fetch takes: invisible on a warm cache, long enough to screenshot
// on a cold one.
//
// This is the leading hypothesis for the reported defect, not a confirmed
// diagnosis -- the device check in SKYC-138 still has to rule out a wrong
// logo_url on the team row the game joins to. The guard is worth having
// either way. expo-image's `recyclingKey` is the documented remedy and is
// already how the Clips feed protects its posters (app/(tabs)/clips.tsx). The
// URL is the identity that matters here: when it changes the view must reset,
// and two teams sharing a URL would render the same logo anyway.
export function TeamBadge({ team, size = 40 }: Props) {
  // Which URLs have failed, rather than a bare boolean. A boolean never reset
  // when `team.logoUrl` changed, so a single failed load suppressed the logo
  // for every team the instance was later handed, for the life of that
  // instance. A set rather than "the last URL that failed" (Codex review,
  // 2026-10-20): a badge that cycles A -> B -> A must not retry A's broken
  // logo just because B failed in between.
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const hasLogo = Boolean(team.logoUrl) && !failedUrls.has(team.logoUrl!);

  const markFailed = (url: string | null) => {
    if (!url) return;
    setFailedUrls((prev) => {
      // Same reference when nothing changed, so a repeated error from the
      // same source cannot loop re-renders.
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

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
          contentFit="contain"
          recyclingKey={team.logoUrl}
          transition={0}
          onError={() => markFailed(team.logoUrl)}
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
