import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const STALE = 2 * 60 * 1000;

export function useIsAdmin() {
  return useQuery<boolean>({
    queryKey: ['admin', 'isAdmin'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from('users')
        .select('is_admin')
        .eq('auth_id', user.id)
        .single();
      return data?.is_admin === true;
    },
    staleTime: STALE,
    retry: false,
  });
}

export function useAdminKpis(days: number) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'kpis', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_admin_kpis', { p_days: days });
      if (error) throw error;
      return data as {
        total_users: number; new_users: number;
        total_parties: number; new_parties: number;
        total_groups: number; new_groups: number;
        total_clips: number; new_clips: number;
        total_rsvps: number; new_rsvps: number;
        flagged_content: number;
      };
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function useSignupsByDay(days: number) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'signupsByDay', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_signups_by_day', { p_days: days });
      if (error) throw error;
      return (data ?? []) as { signup_date: string; signup_count: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function usePartiesByCity(limit = 10) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'partiesByCity'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_parties_by_city', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as { city: string; party_count: number; rsvp_count: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function useGroupsBySport() {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'groupsBySport'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_groups_by_sport');
      if (error) throw error;
      return (data ?? []) as { sport_name: string; group_count: number; total_members: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function useActivityFeed(limit = 50, offset = 0, filter: string | null = null) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'activityFeed', limit, offset, filter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_activity_feed', {
        p_limit: limit,
        p_offset: offset,
        p_filter: filter,
      });
      if (error) throw error;
      return (data ?? []) as {
        event_id: string; event_name: string; user_display: string;
        screen: string | null; metadata: any; created_at: string;
      }[];
    },
    staleTime: 30 * 1000,
    enabled: !!isAdmin,
  });
}

export function useModerationQueue(limit = 50) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'moderationQueue'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_moderation_queue', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as {
        flag_id: string; content_type: string; content_id: string;
        reason: string; details: string | null; flagger_display: string;
        flag_count: number; created_at: string;
      }[];
    },
    staleTime: 30 * 1000,
    enabled: !!isAdmin,
  });
}

export function useGeoCountries() {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'geo', 'countries'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_geo_countries');
      if (error) throw error;
      return (data ?? []) as { country: string; user_count: number; party_count: number; group_count: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin,
  });
}

export function useGeoStates(country: string | null) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'geo', 'states', country],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_geo_states', { p_country: country });
      if (error) throw error;
      return (data ?? []) as { state: string; user_count: number; party_count: number; group_count: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin && !!country,
  });
}

export function useGeoCities(country: string | null, state: string | null) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'geo', 'cities', country, state],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_geo_cities', {
        p_country: country,
        p_state: state,
      });
      if (error) throw error;
      return (data ?? []) as { city: string; user_count: number; party_count: number; group_count: number; clip_count: number }[];
    },
    staleTime: STALE,
    enabled: !!isAdmin && !!country && !!state,
  });
}

export function useGeoCityDetail(city: string | null, state: string | null, country: string | null) {
  const { data: isAdmin } = useIsAdmin();
  return useQuery({
    queryKey: ['admin', 'geo', 'cityDetail', country, state, city],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_geo_city_detail', {
        p_city: city,
        p_state: state,
        p_country: country,
      });
      if (error) throw error;
      return data as {
        kpis: { user_count: number; party_count: number; group_count: number; clip_count: number };
        recent_parties: { id: string; title: string; venue_name: string; rsvp_count: number; starts_at: string }[];
        active_groups: { id: string; name: string; member_count: number }[];
        recent_signups: { id: string; display_name: string; created_at: string }[];
      };
    },
    staleTime: STALE,
    enabled: !!isAdmin && !!city && !!state && !!country,
  });
}
