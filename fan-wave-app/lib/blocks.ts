import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';

export type BlockedUser = {
  blocked_id: string;
  display_name: string;
  blocked_at: string;
};

export async function blockUser(targetAuthId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('block_user', { p_blocked_id: targetAuthId });
    if (error) throw error;
    return true;
  } catch (e) {
    reportError(e, { source: 'blocks:blockUser', targetAuthId });
    return false;
  }
}

export async function unblockUser(targetAuthId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('unblock_user', { p_blocked_id: targetAuthId });
    if (error) throw error;
    return true;
  } catch (e) {
    reportError(e, { source: 'blocks:unblockUser', targetAuthId });
    return false;
  }
}

export async function getMyBlocks(): Promise<BlockedUser[]> {
  try {
    const { data, error } = await supabase.rpc('get_my_blocks');
    if (error) throw error;
    return (data as BlockedUser[]) ?? [];
  } catch (e) {
    reportError(e, { source: 'blocks:getMyBlocks' });
    return [];
  }
}
