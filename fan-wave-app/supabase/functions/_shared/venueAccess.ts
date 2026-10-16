export async function authorizeVenueSearch(
  token: string | undefined,
  caller: { auth: { getUser: (token: string) => PromiseLike<any> }; rpc: (name: string, args: any) => PromiseLike<any> },
): Promise<{ status: number; message: string } | null> {
  if (!token) return { status: 401, message: 'Sign in to search venues' };
  const { data, error } = await caller.auth.getUser(token);
  if (error || !data?.user || data.user.is_anonymous) return { status: 401, message: 'Sign in to search venues' };
  const { data: allowed, error: limitError } = await caller.rpc('check_rate_limit', {
    p_user_id: data.user.id, p_action: 'venue_search', p_max_count: 20, p_window_seconds: 60,
  });
  if (limitError) return { status: 503, message: 'Venue search temporarily unavailable' };
  if (allowed !== true) return { status: 429, message: 'Too many searches. Try again in a minute.' };
  return null;
}
