export type FollowTier = 'lite' | 'social' | 'all_in';

export interface TierDefinition {
  id: FollowTier;
  label: string;
  icon: string;
  description: string;
  color: string;
  includes: ContentType[];
  shortLabel: string;
  includesSummary: string[];
}

export interface UserTeamFollow {
  id: string;
  user_id: string;
  team_id: string;
  tier: FollowTier;
  followed_at: string;
  team_name?: string;
  team_code?: string;
  team_city?: string;
  team_logo_url?: string;
  team_colors?: Record<string, string>;
  league_name?: string;
  sport_name?: string;
  sport_icon?: string;
}

export type ContentType =
  | 'scores'
  | 'results'
  | 'top_highlights'
  | 'group_chat'
  | 'watch_parties'
  | 'clips'
  | 'moments'
  | 'live_alerts'
  | 'all_clips';

export const FOLLOW_TIERS: TierDefinition[] = [
  {
    id: 'lite',
    label: 'Stay in the Loop',
    icon: '📊',
    description: 'Scores and top plays, no noise',
    color: '#0096ff',
    includes: ['scores', 'results', 'top_highlights'],
    shortLabel: 'Lite',
    includesSummary: ['Scores', 'Highlights'],
  },
  {
    id: 'social',
    label: 'Join the Tribe',
    icon: '👥',
    description: 'Chat, parties, and your crew\'s best clips',
    color: '#6c5ce7',
    includes: ['scores', 'results', 'top_highlights', 'group_chat', 'watch_parties', 'clips'],
    shortLabel: 'Social',
    includesSummary: ['Scores', 'Groups', 'Parties', 'Clips'],
  },
  {
    id: 'all_in',
    label: 'Live the Game',
    icon: '🔥',
    description: 'Every alert, every moment, nothing missed',
    color: '#ff4444',
    includes: [
      'scores', 'results', 'top_highlights', 'group_chat',
      'watch_parties', 'clips', 'moments', 'live_alerts', 'all_clips',
    ],
    shortLabel: 'All In',
    includesSummary: ['Everything', 'Live Alerts', 'Moments'],
  },
];

export const TIER_BY_ID: Record<FollowTier, TierDefinition> = Object.fromEntries(
  FOLLOW_TIERS.map((t) => [t.id, t])
) as Record<FollowTier, TierDefinition>;

export const TIER_ORDER: Record<FollowTier, number> = {
  lite: 0,
  social: 1,
  all_in: 2,
};

export function tierIncludesContent(tier: FollowTier, contentType: ContentType): boolean {
  const def = TIER_BY_ID[tier];
  return def ? def.includes.includes(contentType) : false;
}

export function getTeamsForContentType(
  follows: UserTeamFollow[],
  contentType: ContentType
): string[] {
  return follows
    .filter((f) => tierIncludesContent(f.tier, contentType))
    .map((f) => f.team_id);
}

export function getTierDistribution(follows: UserTeamFollow[]): Record<FollowTier, number> {
  const dist: Record<FollowTier, number> = { lite: 0, social: 0, all_in: 0 };
  follows.forEach((f) => {
    if (dist[f.tier] !== undefined) dist[f.tier]++;
  });
  return dist;
}
