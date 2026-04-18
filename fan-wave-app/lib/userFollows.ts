import { supabase } from './supabase';

/**
 * Follow a user. Optimistic — call and forget with error handling upstream.
 */
export async function followUser(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('follow_user', { p_following_id: userId });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Unfollow a user.
 */
export async function unfollowUser(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('unfollow_user', { p_following_id: userId });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Check if current user follows a given user.
 */
export async function checkIsFollowing(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.rpc('is_following', { p_user_id: userId });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Get followers of a user.
 */
export async function getFollowers(userId: string, limit = 50, offset = 0) {
  const { data, error } = await supabase.rpc('get_followers', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return [];
  return data ?? [];
}

/**
 * Get users that a given user follows.
 */
export async function getFollowing(userId: string, limit = 50, offset = 0) {
  const { data, error } = await supabase.rpc('get_following', {
    p_user_id: userId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return [];
  return data ?? [];
}
