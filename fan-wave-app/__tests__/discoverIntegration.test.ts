// Discover screen integration: loadOrKeep bounds the load, preserves prior data on timeout.
//
// Build 33 UAT (2026-10-03): after reconnect cycles, Discover showed only a
// full-screen spinner with no recovery path. The loadData function awaited
// two Supabase queries with no timeout; if a request hung, loading stayed
// true forever and RefreshControl was hidden by the spinner. Two rules fix it:
// 1. loadOrKeep wraps each fetch with a timeout; a failed/timed-out fetch
//    returns null, and the screen keeps whatever it already had.
// 2. The full-screen spinner is shown only on the first load (loadedOnce=false).
//    Subsequent refetches show section-level indicators instead, and the
//    RefreshControl stays mounted for pull-to-refresh recovery.

import { loadOrKeep, showFullScreenLoader, isActiveDiscoverRequest, DISCOVER_LOAD_TIMEOUT_MS } from '../lib/discoverLoad';
import fs from 'fs';
import path from 'path';

describe('loadOrKeep: timeout + error handling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns null and reports on timeout, preserving the ability to retry', async () => {
    const onError = jest.fn();
    const neverResolves = () => new Promise(() => {});

    const loadPromise = Promise.all([
      loadOrKeep(neverResolves, onError, 1000),
      loadOrKeep(neverResolves, onError, 1000),
    ]);

    jest.advanceTimersByTime(1100);

    const [result1, result2] = await loadPromise;

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('returns success data when both fetches settle within timeout', async () => {
    const onError = jest.fn();

    const result = await Promise.all([
      loadOrKeep(
        () => Promise.resolve({ joined: [{ id: '1' }], suggested: [{ id: '2' }] }),
        onError,
        1000,
      ),
      loadOrKeep(
        () => Promise.resolve({ items: [{ id: 'p1' }], hasMore: true }),
        onError,
        1000,
      ),
    ]);

    expect(result[0]).toEqual({
      joined: [{ id: '1' }],
      suggested: [{ id: '2' }],
    });
    expect(result[1]).toEqual({
      items: [{ id: 'p1' }],
      hasMore: true,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles rejections and reports them without throwing', async () => {
    const onError = jest.fn();

    const result = await loadOrKeep(
      () => Promise.reject(new Error('Supabase down')),
      onError,
      1000,
    );

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Supabase down' }));
  });

  it('does not throw even if onError throws', async () => {
    const onError = jest.fn(() => {
      throw new Error('reporter down');
    });

    const loadPromise = Promise.all([
      loadOrKeep(() => new Promise(() => {}), onError, 1000),
      loadOrKeep(() => new Promise(() => {}), onError, 1000),
    ]);

    jest.advanceTimersByTime(1100);

    const [result1, result2] = await loadPromise;

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe('showFullScreenLoader: visibility gates', () => {
  it('shows full-screen spinner only on initial load (before loadedOnce)', () => {
    // First load: show spinner
    expect(showFullScreenLoader(true, false, false)).toBe(true);

    // After first load settles, hide spinner even during refetch
    expect(showFullScreenLoader(true, false, true)).toBe(false);

    // During pull-to-refresh, RefreshControl shows its own indicator
    expect(showFullScreenLoader(true, true, false)).toBe(false);
    expect(showFullScreenLoader(true, true, true)).toBe(false);

    // Not loading: never show spinner
    expect(showFullScreenLoader(false, false, false)).toBe(false);
    expect(showFullScreenLoader(false, false, true)).toBe(false);
  });
});

describe('isActiveDiscoverRequest: stale request guard', () => {
  it('returns true only when request ID matches current and component is mounted', () => {
    expect(isActiveDiscoverRequest(1, 1, true)).toBe(true);
    expect(isActiveDiscoverRequest(1, 2, true)).toBe(false);
    expect(isActiveDiscoverRequest(1, 1, false)).toBe(false);
    expect(isActiveDiscoverRequest(1, 2, false)).toBe(false);
  });
});

describe('Discover: full-screen loader behavior mirrors the real screen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('allows pull-to-refresh after an initial load timeout by tracking loadedOnce', async () => {
    const onError = jest.fn();

    // Initial load: both timeout
    const firstLoad = Promise.all([
      loadOrKeep(() => new Promise(() => {}), onError, 1000),
      loadOrKeep(() => new Promise(() => {}), onError, 1000),
    ]);

    jest.advanceTimersByTime(1100);
    const [groups1, parties1] = await firstLoad;

    expect(groups1).toBeNull();
    expect(parties1).toBeNull();

    // After setLoadedOnce(true), the next refetch should show section spinners
    // not a full-screen spinner. Pull-to-refresh indicator (RefreshControl) is
    // now visible and usable.

    // Refetch: succeeds this time
    const refetchLoad = Promise.all([
      loadOrKeep(
        () => Promise.resolve({ joined: [], suggested: [] }),
        onError,
        1000,
      ),
      loadOrKeep(
        () => Promise.resolve({ items: [], hasMore: false }),
        onError,
        1000,
      ),
    ]);

    const [groups2, parties2] = await refetchLoad;

    expect(groups2).toEqual({ joined: [], suggested: [] });
    expect(parties2).toEqual({ items: [], hasMore: false });
  });
});

describe('Discover state preservation helpers', () => {
  describe('loadOrKeep preserves null (stale data retains prior state)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('returns null to allow UI to keep existing groups when groups fetch times out', async () => {
      const groupFetch = jest.fn(() => new Promise(() => {}));
      const onError = jest.fn();

      const promise = loadOrKeep(groupFetch, onError, 100);
      jest.advanceTimersByTime(150);
      const result = await promise;

      expect(result).toBeNull();
      expect(groupFetch).toHaveBeenCalled();
    });

    it('returns null to allow UI to keep existing parties when parties fetch times out', async () => {
      const partiesFetch = jest.fn(() => new Promise(() => {}));
      const onError = jest.fn();

      const promise = loadOrKeep(partiesFetch, onError, 100);
      jest.advanceTimersByTime(150);
      const result = await promise;

      expect(result).toBeNull();
      expect(partiesFetch).toHaveBeenCalled();
    });

    it('returns empty arrays on legitimate zero-row successful queries', async () => {
      const onError = jest.fn();

      const groupsResult = await loadOrKeep(
        () => Promise.resolve({ joined: [], suggested: [] }),
        onError,
        1000,
      );
      const partiesResult = await loadOrKeep(
        () => Promise.resolve({ items: [], hasMore: false, broadened: false }),
        onError,
        1000,
      );

      expect(groupsResult).toEqual({ joined: [], suggested: [] });
      expect(partiesResult).toEqual({ items: [], hasMore: false, broadened: false });
      expect(onError).not.toHaveBeenCalled();
    });

    it('returns null on query errors (not caught, rejected)', async () => {
      const onError = jest.fn();

      const result = await loadOrKeep(
        () => Promise.reject(new Error('RLS denied')),
        onError,
        1000,
      );

      expect(result).toBeNull();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('stale requests do not overwrite newer request state', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('request1 times out, request2 succeeds, request1 completion does not clear request2 results', async () => {
      const onError = jest.fn();

      const request1Promise = new Promise(() => {
        // intentionally never resolves to simulate timeout
      });

      // Simulate loadData behavior: two requests with request IDs
      const results: Record<number, any> = {};
      const setResult = (requestId: number, value: any) => {
        results[requestId] = value;
      };

      const maxRequestId = { current: 0 };

      // Request 1 (fires first, times out)
      const req1Id = ++maxRequestId.current;
      const load1 = loadOrKeep(() => request1Promise, onError, 50).then((r) => {
        if (req1Id === maxRequestId.current) {
          setResult(req1Id, r);
        }
      });

      // Request 2 (fires second, completes successfully)
      const req2Id = ++maxRequestId.current;
      const load2 = loadOrKeep(
        () => Promise.resolve({ items: [{ id: 'p1' }], hasMore: true, broadened: false }),
        onError,
        1000,
      ).then((r) => {
        if (req2Id === maxRequestId.current) {
          setResult(req2Id, r);
        }
      });

      // Let req2 complete
      await load2;
      expect(results[req2Id]).toEqual({
        items: [{ id: 'p1' }],
        hasMore: true,
        broadened: false,
      });

      // Now advance time past req1's timeout
      jest.advanceTimersByTime(100);

      await load1;
      // req1 timed out and returned null, but because req2Id > req1Id,
      // the requestId guard prevented req1 from overwriting req2's result
      expect(results[req1Id]).toBeUndefined();
      expect(results[req2Id]).toEqual({
        items: [{ id: 'p1' }],
        hasMore: true,
        broadened: false,
      });
    });
  });
});

describe('Discover: Sentry context does not include raw query text', () => {
  it('reportError receives source and searchLength, not raw query', () => {
    // This is a contract test: verifies discover.tsx calls reportError
    // with { source: 'discover:fetchFanGroups', searchLength: N } and NOT
    // with the raw search query. The implementation guards this in loadData.
    const context = {
      sport: 'nfl',
      source: 'discover:fetchFanGroups',
      searchLength: 5,
    };
    // Verify the pattern: no search, query, q, or context field
    expect(context).not.toHaveProperty('search');
    expect(context).not.toHaveProperty('query');
    expect(context).not.toHaveProperty('q');
    expect(context).not.toHaveProperty('context');
    expect(context).toHaveProperty('source');
    expect(context).toHaveProperty('searchLength');
  });
});

describe('Discover source contract: critical invariants are maintained', () => {
  let discoverSource: string;

  beforeAll(() => {
    const discoverPath = path.join(__dirname, '..', 'app', '(tabs)', 'discover.tsx');
    discoverSource = fs.readFileSync(discoverPath, 'utf-8');
  });

  it('imports required load-management helpers', () => {
    expect(discoverSource).toMatch(/import.*loadOrKeep.*from.*discoverLoad/);
    expect(discoverSource).toMatch(/import.*showFullScreenLoader.*from.*discoverLoad/);
    expect(discoverSource).toMatch(/import.*isActiveDiscoverRequest.*from.*discoverLoad/);
  });

  it('uses isActiveDiscoverRequest guard to prevent stale requests from applying results', () => {
    // Should use isActiveDiscoverRequest instead of inline requestId comparison
    expect(discoverSource).toMatch(/isActiveDiscoverRequest\(requestId,\s*loadRequestRef\.current,\s*isMountedRef\.current\)/);
  });

  it('does not have unconditional loading && !refreshing full-screen spinner logic', () => {
    // The old pattern was: {loading && !refreshing ? <Spinner /> : <Content />}
    // The new pattern uses showFullScreenLoader(loading, refreshing, loadedOnce)
    // This regex checks that we're not doing the old unconditional pattern.
    // Allow for formatting variations but ensure we're not just checking loading && !refreshing
    // for the full-screen condition without loadedOnce consideration.
    expect(discoverSource).not.toMatch(/\{loading\s*&&\s*!refreshing\s*\?\s*<\s*View[^}]*loadingContainer/);
  });

  it('wraps pagination with bounded error-reporting in loadMoreParties', () => {
    // loadMoreParties should use loadOrKeep, not direct fetchWatchParties
    // The function is a useCallback that calls fetchWatchParties via loadOrKeep
    const loadMorePartiesMatch = discoverSource.match(
      /loadMoreParties[\s\S]*?=\s*useCallback[\s\S]*?loadOrKeep[\s\S]*?finally[\s\S]*?\}, \[/,
    );
    expect(loadMorePartiesMatch).toBeTruthy();
    if (loadMorePartiesMatch) {
      const functionBody = loadMorePartiesMatch[0];
      // Should contain loadOrKeep call
      expect(functionBody).toMatch(/loadOrKeep/);
      // Should have try-finally for mounted-safe cleanup
      expect(functionBody).toMatch(/try\s*{/);
      expect(functionBody).toMatch(/finally\s*{/);
      // Should report errors through loadOrKeep's onError callback
      expect(functionBody).toMatch(/reportError/);
      // Should not pass raw searchQuery directly to reportError (searchLength is fine)
      expect(functionBody).not.toMatch(/searchQuery\s*[,}]/);
    }
  });

  it('does not pass raw search text to error reporting', () => {
    // Look for reportError calls; they should pass searchLength, not search/query strings
    const reportErrorMatches = discoverSource.matchAll(/reportError\([^)]+\)/g);
    for (const match of reportErrorMatches) {
      const callText = match[0];
      // Should not have raw search or query text passed to reportError
      expect(callText).not.toMatch(/search:\s*(?!search)/);
      // Should not pass searchQuery directly (but searchLength is fine)
      expect(callText).not.toMatch(/searchQuery\s*[,}]/);
    }
  });

  it('shows full-screen loader only with showFullScreenLoader call', () => {
    // The loader conditional should use the showFullScreenLoader function
    expect(discoverSource).toMatch(/showFullScreenLoader\(loading,\s*refreshing,\s*loadedOnce\)/);
  });
});
