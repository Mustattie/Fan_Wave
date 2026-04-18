import { supabase } from './supabase';

// ── Badge Check (call after key actions) ─────────────────

/**
 * Check and award any badges the user has earned.
 * Call after: joining a group, RSVPing, posting a clip, etc.
 * Returns any newly awarded badges.
 */
export async function checkAndAwardBadges(): Promise<{ key: string; name: string; icon: string }[]> {
  try {
    const { data } = await supabase.rpc('check_and_award_badges');
    return data ?? [];
  } catch {
    return [];
  }
}

// ── Streaks ──────────────────────────────────────────────

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
}

/**
 * Record daily activity and get updated streak info.
 * Call on app open (after auth).
 */
export async function recordDailyActivity(): Promise<StreakInfo> {
  try {
    const { data, error } = await supabase.rpc('record_daily_activity');
    if (error || !data || data.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }
    const row = data[0];
    return {
      currentStreak: row.current_streak ?? 0,
      longestStreak: row.longest_streak ?? 0,
    };
  } catch {
    return { currentStreak: 0, longestStreak: 0 };
  }
}

// ── Badges ───────────────────────────────────────────────

export interface Badge {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export interface UserBadge {
  badge: Badge;
  earnedAt: string;
}

/**
 * Get all badges the current user has earned.
 */
export async function getUserBadges(): Promise<UserBadge[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('user_badges')
      .select('earned_at, badge:badges(id, key, name, description, icon, category)')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false });

    if (error || !data) return [];

    return data.map((row: any) => ({
      badge: row.badge,
      earnedAt: row.earned_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Get all available badges (for display in a badge gallery).
 */
export async function getAllBadges(): Promise<Badge[]> {
  try {
    const { data, error } = await supabase
      .from('badges')
      .select('*')
      .order('category');

    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

// ── Trending ─────────────────────────────────────────────

/**
 * Get trending clips from the materialized view.
 */
export async function getTrendingClips(limit = 10) {
  try {
    const { data } = await supabase
      .from('trending_clips')
      .select('*')
      .order('score', { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Get trending groups from the materialized view.
 */
export async function getTrendingGroups(limit = 10) {
  try {
    const { data } = await supabase
      .from('trending_groups')
      .select('*')
      .order('score', { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Get hot watch parties from the materialized view.
 */
export async function getHotWatchParties(limit = 10) {
  try {
    const { data } = await supabase
      .from('hot_watch_parties')
      .select('*')
      .order('score', { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}
