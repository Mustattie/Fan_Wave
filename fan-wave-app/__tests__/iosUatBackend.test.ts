import { scheduledGameTime, gameTimeForWrite } from '../supabase/functions/_shared/gameTime';
import { authorizeVenueSearch } from '../supabase/functions/_shared/venueAccess';
import { venueRanker } from '../supabase/functions/_shared/venueRanking';

describe('SKYC-137 ESPN time validity', () => {
  const date = '2026-10-23T04:00:00Z';
  it('discards a concrete placeholder when timeValid=false', () => expect(scheduledGameTime({ date }, { timeValid: false })).toBeNull());
  it('never invents a kickoff for missing or invalid dates', () => {
    expect(scheduledGameTime({}, {})).toBeNull();
    expect(scheduledGameTime({ date: 'bad' }, {})).toBeNull();
  });
  it('prefers valid competition time and preserves dated events', () => {
    expect(scheduledGameTime({ date }, { date: '2026-10-23T20:00:00Z', timeValid: true })).toBe('2026-10-23T20:00:00Z');
    expect(scheduledGameTime({ date }, {})).toBe(date);
  });
  it('preserves known time on missing data, but clears an explicitly invalid placeholder', () => {
    expect(gameTimeForWrite(null, false, date)).toBe(date);
    expect(gameTimeForWrite(null, true, date)).toBeNull();
    expect(gameTimeForWrite(null, false, undefined)).toBeNull();
    expect(gameTimeForWrite(date, false, null)).toBe(date);
  });
});

describe('SKYC-125 venue authorization', () => {
  function client(user: any, error: any = null, allowed: any = true, limitError: any = null) {
    return { auth: { getUser: jest.fn(async () => ({ data: { user }, error })) }, rpc: jest.fn(async () => ({ data: allowed, error: limitError })) };
  }
  it.each([undefined, 'anon-key', 'expired-token'])('rejects absent/anon/invalid session %s without consuming quota', async token => {
    const c = client(null, token ? { message: 'not a user' } : null);
    expect((await authorizeVenueSearch(token, c))?.status).toBe(401);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it('rejects Supabase anonymous users too', async () => {
    const c = client({ id: 'anonymous-user', is_anonymous: true });
    expect((await authorizeVenueSearch('jwt', c))?.status).toBe(401);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it('uses verified identity and the atomic 20/minute limiter for an authenticated user', async () => {
    const c = client({ id: 'verified-user', is_anonymous: false });
    expect(await authorizeVenueSearch('jwt', c)).toBeNull();
    expect(c.rpc).toHaveBeenCalledWith('check_rate_limit', { p_user_id: 'verified-user', p_action: 'venue_search', p_max_count: 20, p_window_seconds: 60 });
  });
  it('fails closed on exhausted quota, unavailable limiter, or unexpected response', async () => {
    expect((await authorizeVenueSearch('jwt', client({ id: 'u' }, null, false)))?.status).toBe(429);
    expect((await authorizeVenueSearch('jwt', client({ id: 'u' }, null, null, {})))?.status).toBe(503);
    expect((await authorizeVenueSearch('jwt', client({ id: 'u' }, null, null)))?.status).toBe(429);
  });
});

it('SKYC-131 puts actual Prosper venues before nearer Dallas/Frisco results', () => {
  const venues = [
    { address: '1 Prosper Rd, Frisco, TX 75034, USA', distanceMeters: 1000 },
    { address: '3 Main St, Dallas, TX 75001, USA', distanceMeters: 500 },
    { address: '2 Main St, Prosper, TX 75078, USA', distanceMeters: 40000 },
  ];
  expect([...venues].sort(venueRanker('Prosper TX'))[0].address).toContain(', Prosper,');
  expect([...venues].sort(venueRanker('sports bars in Prosper, TX'))[0].address).toContain(', Prosper,');
  expect([...venues].sort(venueRanker('The Brass Tap'))[0].distanceMeters).toBe(500);
});
