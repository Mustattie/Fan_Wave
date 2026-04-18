import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { UserTeamFollow, FollowTier } from '@/constants/FollowTiers';

const dismissedPrompts = new Set<string>();

export function shouldShowUpsell(teamId: string): boolean {
  return !dismissedPrompts.has(teamId);
}

export function dismissUpsell(teamId: string): void {
  dismissedPrompts.add(teamId);
}

export function getTierForTeam(follows: UserTeamFollow[], teamId: string): FollowTier | null {
  const follow = follows.find((f) => f.team_id === teamId);
  return follow ? follow.tier : null;
}

export async function upgradeTier(userId: string, teamId: string, newTier: FollowTier): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('follow_team', {
      p_user_id: userId,
      p_team_id: teamId,
      p_tier: newTier,
    });
    if (error) throw error;
    try {
      await supabase.from('analytics_events').insert({
        user_id: userId,
        event_name: 'tier_upsell_accepted',
        metadata: { team_id: teamId, new_tier: newTier },
      });
    } catch {}
    return true;
  } catch {
    return false;
  }
}

export async function loadFollowsFromStorage(): Promise<UserTeamFollow[]> {
  try {
    const raw = await AsyncStorage.getItem('followed_teams');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === 'string') {
        return parsed.map((id: string) => ({
          id, user_id: '', team_id: id, tier: 'social' as FollowTier, followed_at: '',
        }));
      }
      return parsed.map((item: any) => ({
        id: item.teamId || item.team_id || '',
        user_id: '',
        team_id: item.teamId || item.team_id || '',
        tier: (item.tier || 'social') as FollowTier,
        followed_at: '',
      }));
    }
    return [];
  } catch {
    return [];
  }
}
