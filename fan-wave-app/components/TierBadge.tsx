import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck, Shield } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

/**
 * The public half of a paid tier.
 *
 * Before v9.5 the paywall sold "Home Team badge on your profile" and the app
 * rendered that badge on the Subscription row of your OWN profile screen —
 * visible to nobody but you. A badge nobody else can see is not a badge, it
 * is a receipt. This renders the tier where other fans actually encounter
 * you: clip cards, attendee lists, member lists.
 *
 * Reads a tier string that came from get_public_profiles (mig 089), which is
 * the only way a client can learn anyone else's tier — users RLS is
 * own-profile-only. `free`, unknown values, and undefined all render nothing,
 * so every call site is safe to wire up unconditionally.
 */
export type BadgeTier = 'free' | 'home_team' | 'mvp' | 'business' | string | null | undefined;

interface Props {
  tier: BadgeTier;
  /** Icon-only, for dense rows like member lists. */
  compact?: boolean;
}

export function TierBadge({ tier, compact = false }: Props) {
  if (tier !== 'home_team' && tier !== 'mvp') return null;

  const isMvp = tier === 'mvp';
  const label = isMvp ? 'MVP' : 'Home Team';
  const color = isMvp ? Colors.dark.accent : '#4A90D9';
  const Icon = isMvp ? BadgeCheck : Shield;

  return (
    <View
      style={[styles.badge, compact && styles.badgeCompact, { borderColor: color }]}
      accessibilityLabel={isMvp ? 'Verified MVP creator' : 'Home Team member'}
    >
      <Icon size={compact ? 12 : 13} color={color} />
      {!compact && <Text style={[styles.label, { color }]}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  badgeCompact: { paddingHorizontal: 4 },
  label: { fontSize: 11, fontWeight: '700' },
});
