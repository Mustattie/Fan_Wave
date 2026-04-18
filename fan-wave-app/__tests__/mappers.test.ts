import {
  getSportEmoji,
  getSportColor,
  formatRelativeTime,
  formatFullDate,
} from '../lib/mappers';

describe('getSportEmoji', () => {
  it('returns correct emoji for known sports', () => {
    expect(getSportEmoji('nfl')).toBeDefined();
    expect(getSportEmoji('nba')).toBeDefined();
    expect(getSportEmoji('soccer')).toBeDefined();
  });

  it('returns default trophy for null/undefined', () => {
    expect(getSportEmoji(null)).toBe('🏆');
    expect(getSportEmoji(undefined)).toBe('🏆');
    expect(getSportEmoji('')).toBe('🏆');
  });
});

describe('getSportColor', () => {
  it('returns a hex color string for known sports', () => {
    const color = getSportColor('nfl');
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('returns a fallback color for unknown sport', () => {
    const color = getSportColor('curling');
    expect(typeof color).toBe('string');
  });
});

describe('formatRelativeTime', () => {
  it('returns "Just now" for recent times', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('Just now');
  });

  it('returns minutes ago for times within the hour', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatRelativeTime(tenMinAgo)).toBe('10m ago');
  });

  it('returns hours ago for times within the day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago for older times', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
  });
});

describe('formatFullDate', () => {
  it('returns a human-readable full date', () => {
    const result = formatFullDate('2026-06-11T15:00:00Z');
    expect(result).toContain('June');
    expect(result).toContain('11');
    expect(result).toContain('2026');
  });
});
