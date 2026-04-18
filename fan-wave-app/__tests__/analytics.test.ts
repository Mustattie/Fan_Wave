import { trackEvent, setAnalyticsUser, startAnalyticsFlush, stopAnalyticsFlush } from '../lib/analytics';
import { supabase } from '../lib/supabase';

// Access the mocked supabase
const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
(supabase.from as jest.Mock).mockReturnValue({ insert: mockInsert });

describe('Analytics batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    stopAnalyticsFlush();
    jest.useRealTimers();
  });

  it('does not send immediately on trackEvent', async () => {
    await trackEvent('app_open');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('flushes after 30 seconds when timer is running', async () => {
    startAnalyticsFlush();
    await trackEvent('app_open');
    await trackEvent('sign_in');

    // Advance timer by 30 seconds
    jest.advanceTimersByTime(30_000);

    // Allow promises to resolve
    await Promise.resolve();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ event_name: 'app_open' }),
        expect.objectContaining({ event_name: 'sign_in' }),
      ])
    );
  });

  it('includes user_id when set', async () => {
    setAnalyticsUser('user-123');
    await trackEvent('clip_uploaded');

    startAnalyticsFlush();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'user-123', event_name: 'clip_uploaded' }),
      ])
    );

    setAnalyticsUser(null); // cleanup
  });
});
