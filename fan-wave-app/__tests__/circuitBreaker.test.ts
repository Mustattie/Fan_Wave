import { CircuitBreaker } from '../lib/circuitBreaker';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('stays CLOSED on successful calls', async () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    const result = await cb.execute(() => Promise.resolve('ok'), 'fallback');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns fallback and opens after threshold failures', async () => {
    const cb = new CircuitBreaker({ threshold: 2, resetTimeout: 60000 });
    const failing = () => Promise.reject(new Error('fail'));

    await cb.execute(failing, 'fallback');
    expect(cb.getState()).toBe('CLOSED'); // 1 failure, threshold is 2

    await cb.execute(failing, 'fallback');
    expect(cb.getState()).toBe('OPEN'); // 2 failures

    // Now in OPEN state, should return fallback without calling fn
    const spy = jest.fn(() => Promise.resolve('should not run'));
    const result = await cb.execute(spy, 'fallback');
    expect(result).toBe('fallback');
    expect(spy).not.toHaveBeenCalled();
  });

  it('transitions to HALF_OPEN after resetTimeout', async () => {
    const cb = new CircuitBreaker({ threshold: 1, resetTimeout: 50 });
    await cb.execute(() => Promise.reject(new Error('fail')), 'fallback');
    expect(cb.getState()).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // Next call should go through (HALF_OPEN probe)
    const result = await cb.execute(() => Promise.resolve('recovered'), 'fallback');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns to OPEN if probe fails in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ threshold: 1, resetTimeout: 50 });
    await cb.execute(() => Promise.reject(new Error('fail')), 'fallback');
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60));

    // Probe fails
    await cb.execute(() => Promise.reject(new Error('still failing')), 'fallback');
    expect(cb.getState()).toBe('OPEN');
  });

  it('resets failure count on success', async () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    await cb.execute(() => Promise.reject(new Error('f1')), 'fb');
    await cb.execute(() => Promise.reject(new Error('f2')), 'fb');
    // 2 failures — one more would open

    // Success resets counter
    await cb.execute(() => Promise.resolve('ok'), 'fb');
    expect(cb.getState()).toBe('CLOSED');

    // Need 3 fresh failures to open now
    await cb.execute(() => Promise.reject(new Error('f1')), 'fb');
    await cb.execute(() => Promise.reject(new Error('f2')), 'fb');
    expect(cb.getState()).toBe('CLOSED'); // Still only 2
  });
});
