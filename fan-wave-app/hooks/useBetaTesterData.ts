import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useIsAdmin } from './useAdminData';

const STALE = 60 * 1000;

export interface TesterSummaryRow {
  user_id: string;
  display_name: string;
  cohort: string;
  recruited_via: string | null;
  added_at: string;
  first_event_at: string | null;
  last_event_at: string | null;
  active_days: number;
  total_events: number;
  screens_visited: number;
  distinct_event_types: number;
  sessions_estimated: number;
  signed_up: boolean;
  onboarded: boolean;
  created_group: boolean;
  joined_group: boolean;
  created_party: boolean;
  rsvped_party: boolean;
  sent_message: boolean;
  uploaded_clip: boolean;
  liked_clip: boolean;
  shared_clip: boolean;
  exported_clip: boolean;
  shared_invite: boolean;
  opened_paywall: boolean;
  visited_world_cup_tab: boolean;
  sandbox_purchase_attempts: number;
  latest_entitlement_status: string | null;
}

export interface TesterDailyRow {
  activity_date: string;
  event_count: number;
  distinct_types: number;
  sessions: number;
}

export interface TesterCohortSummary {
  cohort: string;
  tester_count: number;
  active_testers: number;
  avg_active_days: number;
  total_events: number;
  total_purchase_probes: number;
}

export function useTesterSummary(days: number, cohort: string | null = null) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery<TesterSummaryRow[]>({
    queryKey: ['admin', 'testers', 'summary', days, cohort],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_tester_activity_summary', {
        p_days: days,
        p_cohort: cohort,
      });
      if (error) throw error;
      return (data ?? []) as TesterSummaryRow[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function useTesterDaily(userId: string | null, days: number) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery<TesterDailyRow[]>({
    queryKey: ['admin', 'testers', 'daily', userId, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_tester_daily_activity', {
        p_user_id: userId,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as TesterDailyRow[];
    },
    staleTime: STALE,
    enabled: !!isAdmin && !!userId,
  });
}

export function useTesterCohortSummary(days: number) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery<TesterCohortSummary[]>({
    queryKey: ['admin', 'testers', 'cohorts', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_tester_cohort_summary', {
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as TesterCohortSummary[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}
