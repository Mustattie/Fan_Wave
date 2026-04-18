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
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. Default: 3 */
  threshold?: number;
  /** Time in ms before allowing a probe request. Default: 60000 (1 min) */
  resetTimeout?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(options?: CircuitBreakerOptions) {
    this.threshold = options?.threshold ?? 3;
    this.resetTimeout = options?.resetTimeout ?? 60_000;
  }

  async execute<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        return fallback;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch {
      this.onFailure();
      return fallback;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
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

// Pre-configured breakers for external services
export const nominatimBreaker = new CircuitBreaker({ threshold: 3, resetTimeout: 60_000 });
export const overpassBreaker = new CircuitBreaker({ threshold: 2, resetTimeout: 120_000 });
