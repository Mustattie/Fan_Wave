import { isUsableDsn, dedupeAppBreadcrumbMirrors } from '../lib/errorReporting';

describe('native/JS breadcrumb mirrors', () => {
  it('keeps one copy of each actual app emission despite native timestamp drift', () => {
    const first = { message: 'presence.joined', timestamp: 1, data: { fan_sphere_breadcrumb_id: 'run:1' } };
    const mirror = { ...first, timestamp: 1.001 };
    const nextOpen = { ...first, timestamp: 2, data: { fan_sphere_breadcrumb_id: 'run:2' } };
    expect(dedupeAppBreadcrumbMirrors([first, mirror, nextOpen])).toEqual([first, nextOpen]);
  });

  it('retains genuine repeated emissions and unmarked native breadcrumbs', () => {
    const crumbs = [
      { message: 'presence.joined', data: { fan_sphere_breadcrumb_id: 'run:1' } },
      { message: 'presence.joined', data: { fan_sphere_breadcrumb_id: 'run:2' } },
      { message: 'native event', data: {} },
      { message: 'native event', data: {} },
    ];
    expect(dedupeAppBreadcrumbMirrors(crumbs)).toEqual(crumbs);
    expect(dedupeAppBreadcrumbMirrors(undefined)).toBeUndefined();
  });
});

describe('isUsableDsn', () => {
  it('accepts a real-shaped DSN', () => {
    expect(isUsableDsn('https://abc123def456@o123456.ingest.us.sentry.io/4501234567890123')).toBe(true);
    expect(isUsableDsn('  https://key@o1.ingest.sentry.io/42  ')).toBe(true);
  });

  it('rejects the placeholders the .env templates ship with', () => {
    expect(isUsableDsn('')).toBe(false);
    expect(isUsableDsn('__SET_PROD_SENTRY_DSN__')).toBe(false);
    expect(isUsableDsn('YOUR_SENTRY_DSN')).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(isUsableDsn('http://key@o1.ingest.sentry.io/42')).toBe(false); // not https
    expect(isUsableDsn('https://o1.ingest.sentry.io/42')).toBe(false); // no key
    expect(isUsableDsn('https://key@o1.ingest.sentry.io/')).toBe(false); // no project id
    expect(isUsableDsn('https://key@o1.ingest.sentry.io/project')).toBe(false);
  });
});
