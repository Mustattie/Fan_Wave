// P3.1: refresh failures are Sentry events, deduped per code per minute.
const mockReportMessage = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportMessage: (...a: any[]) => mockReportMessage(...a),
  addBreadcrumb: jest.fn(),
}));

import { recordAuthFailure, _resetAuthTelemetryForTests } from '../lib/authTelemetry';

describe('authTelemetry: refresh failure events', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReportMessage.mockClear();
    _resetAuthTelemetryForTests();
  });
  afterEach(() => jest.useRealTimers());

  it('reports a token failure once per code per minute, with tags', () => {
    recordAuthFailure({ endpoint: 'token', status: 400, errorCode: 'refresh_token_already_used' });
    recordAuthFailure({ endpoint: 'token', status: 400, errorCode: 'refresh_token_already_used' });
    expect(mockReportMessage).toHaveBeenCalledTimes(1);
    expect(mockReportMessage).toHaveBeenCalledWith(
      'auth.refresh_failed',
      'warning',
      { status: 400, errorCode: 'refresh_token_already_used' },
      { auth_endpoint: 'token', auth_error_code: 'refresh_token_already_used' },
    );
    jest.advanceTimersByTime(60_001);
    recordAuthFailure({ endpoint: 'token', status: 400, errorCode: 'refresh_token_already_used' });
    expect(mockReportMessage).toHaveBeenCalledTimes(2);
  });

  it('reports the final 429 as rate-limited, not the intermediate retries', () => {
    recordAuthFailure({ endpoint: 'token', status: 429, errorCode: 'over_request_rate_limit' });
    recordAuthFailure({ endpoint: 'token', status: 429, errorCode: 'over_request_rate_limit' });
    expect(mockReportMessage).not.toHaveBeenCalled();
    recordAuthFailure({ endpoint: 'token', status: 429, errorCode: 'over_request_rate_limit_final' });
    expect(mockReportMessage).toHaveBeenCalledWith(
      'auth.refresh_rate_limited',
      'warning',
      expect.objectContaining({ status: 429 }),
      expect.objectContaining({ auth_error_code: 'over_request_rate_limit_final' }),
    );
  });

  it('ignores non-token endpoints', () => {
    recordAuthFailure({ endpoint: 'user', status: 401, errorCode: 'bad_jwt' });
    expect(mockReportMessage).not.toHaveBeenCalled();
  });
});
