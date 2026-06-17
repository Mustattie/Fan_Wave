/**
 * Simple circuit breaker for external API calls.
 *
 * States:
 *   CLOSED  — requests flow normally
 *   OPEN    — requests are rejected immediately (returns fallback)
 *   HALF_OPEN — one probe request allowed to test recovery
 *
 * Transitions:
 *   CLOSED → OPEN:      after `threshold` consecutive failures
 *   OPEN → HALF_OPEN:   after `resetTimeout` ms
 *   HALF_OPEN → CLOSED: if probe succeeds
 *   HALF_OPEN → OPEN:   if probe fails
 *
 * v8.2 (Brass Tap P0): when the breaker short-circuits or the inner fn
 * throws, the breaker still returns `fallback` (existing contract) BUT
 * also exposes `lastError` and `wasShortCircuited` so the caller can
 * tell "no results because API failed" apart from "no results because
 * OSM has nothing". This is what powers the new actionable error
 * messaging on the Create Watch Party screen.
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. Default: 3 */
  threshold?: number;
  /** Time in ms before allowing a probe request. Default: 60000 (1 min) */
  resetTimeout?: number;
  /** Identifier used in diagnostic logs. */
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeout: number;
  private readonly name: string;

  /** Last error thrown by the inner fn (null if last call succeeded or short-circuited). */
  public lastError: Error | null = null;
  /** True if the most recent execute() returned early because the breaker was OPEN. */
  public wasShortCircuited = false;

  constructor(options?: CircuitBreakerOptions) {
    this.threshold = options?.threshold ?? 3;
    this.resetTimeout = options?.resetTimeout ?? 60_000;
    this.name = options?.name ?? 'breaker';
  }

  async execute<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    this.wasShortCircuited = false;

    if (this.state === 'OPEN') {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        this.wasShortCircuited = true;
        const remaining = Math.ceil(
          (this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000
        );
        // Surface in device logs so we don't end up debugging "empty
        // results forever" without a hint that the breaker is the cause.
        console.warn(
          `[circuitBreaker:${this.name}] OPEN — short-circuited (~${remaining}s until probe)`
        );
        return fallback;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[circuitBreaker:${this.name}] inner fn threw:`,
        this.lastError.message
      );
      this.onFailure();
      return fallback;
    }
  }

  /**
   * Force the breaker back to CLOSED. Used when the user explicitly
   * re-taps "Search" after a cooldown — we want their tap to actually
   * try the network, not silently hit the still-OPEN breaker.
   */
  reset(): void {
    if (this.state !== 'CLOSED') {
      console.log(`[circuitBreaker:${this.name}] manually reset to CLOSED`);
    }
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = 0;
    this.lastError = null;
    this.wasShortCircuited = false;
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastError = null;
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// Pre-configured breakers for external services.
// Overpass: 3 failures (was 2 — too eager) before opening for 60s (was 120s);
// Brass Tap P0 had users locked out for 2 minutes after a single bad query.
export const nominatimBreaker = new CircuitBreaker({
  threshold: 3,
  resetTimeout: 60_000,
  name: 'nominatim',
});
export const overpassBreaker = new CircuitBreaker({
  threshold: 3,
  resetTimeout: 60_000,
  name: 'overpass',
});
