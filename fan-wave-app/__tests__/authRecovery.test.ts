import {
  markRecoveryPending,
  clearRecoveryPending,
  isRecoveryPending,
  _resetAuthRecoveryForTests,
} from '../lib/authRecovery';

// The link-type rule (only `type=recovery` marks pending) lives in
// lib/supabase.ts `routeAfterAuthLink`, which the global jest mock replaces;
// it is exercised on-device by the recovery / confirmation link checks.
describe('authRecovery (Build 28: password-recovery routing)', () => {
  beforeEach(() => _resetAuthRecoveryForTests());

  it('starts clear, sets, and clears', () => {
    expect(isRecoveryPending()).toBe(false);
    markRecoveryPending();
    expect(isRecoveryPending()).toBe(true);
    clearRecoveryPending();
    expect(isRecoveryPending()).toBe(false);
  });

  it('is idempotent in both directions', () => {
    markRecoveryPending();
    markRecoveryPending();
    expect(isRecoveryPending()).toBe(true);
    clearRecoveryPending();
    clearRecoveryPending();
    expect(isRecoveryPending()).toBe(false);
  });
});
