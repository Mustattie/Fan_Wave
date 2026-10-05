// Build 33 UAT finding (2026-10-03): Discover stuck on a full-screen spinner
// after reconnect cycles; loadData had no timeout and the loading branch
// hid the list and its RefreshControl.
import { loadOrKeep, showFullScreenLoader, DISCOVER_LOAD_TIMEOUT_MS } from '../lib/discoverLoad';

describe('loadOrKeep', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the value when the load settles in time', async () => {
    const onError = jest.fn();
    const p = loadOrKeep(() => Promise.resolve({ items: [1, 2] }), onError, 1000);
    await expect(p).resolves.toEqual({ items: [1, 2] });
    expect(onError).not.toHaveBeenCalled();
  });

  it('returns null and reports when the load rejects', async () => {
    const onError = jest.fn();
    await expect(loadOrKeep(() => Promise.reject(new Error('boom')), onError, 1000)).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('returns null and reports a timeout when the load never settles', async () => {
    const onError = jest.fn();
    const never = () => new Promise<number>(() => {});
    const p = loadOrKeep(never, onError, 1000);
    jest.advanceTimersByTime(1001);
    await expect(p).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Timeout after 1000ms/) }));
  });

  it('never throws even if the error reporter throws', async () => {
    const onError = jest.fn(() => { throw new Error('reporter down'); });
    await expect(loadOrKeep(() => Promise.reject(new Error('boom')), onError, 1000)).resolves.toBeNull();
  });

  it('defaults to the Discover timeout', () => {
    expect(DISCOVER_LOAD_TIMEOUT_MS).toBe(15_000);
  });
});

describe('showFullScreenLoader', () => {
  it('shows the full-screen spinner only before the first load has settled', () => {
    expect(showFullScreenLoader(true, false, false)).toBe(true);
    expect(showFullScreenLoader(true, false, true)).toBe(false); // refetch: keep the list + RefreshControl
    expect(showFullScreenLoader(true, true, false)).toBe(false); // pull-to-refresh drives its own indicator
    expect(showFullScreenLoader(false, false, false)).toBe(false);
  });
});
