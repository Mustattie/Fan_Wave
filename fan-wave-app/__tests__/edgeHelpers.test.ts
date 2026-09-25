/**
 * Pure helpers shared by the Supabase Edge Functions. These files carry no
 * Deno imports/globals so they can be exercised under Jest.
 */
import {
  classifyExpoTickets,
  backoffSeconds,
} from '../supabase/functions/_shared/expoTickets';
import { gameChanged, stableStringify } from '../supabase/functions/_shared/gameDiff';

const row = (id: string, token: string, retry = 0, max = 3) => ({
  id,
  push_token: token,
  retry_count: retry,
  max_retries: max,
});

describe('classifyExpoTickets', () => {
  it('marks ok tickets as sent', () => {
    const out = classifyExpoTickets([row('a', 'tok-a'), row('b', 'tok-b')], [
      { status: 'ok', id: 'x' },
      { status: 'ok', id: 'y' },
    ]);
    expect(out.sent).toEqual(['a', 'b']);
    expect(out.dead).toEqual([]);
    expect(out.failed).toEqual([]);
    expect(out.deadTokens).toEqual([]);
  });

  it('DeviceNotRegistered -> dead + token collected', () => {
    const out = classifyExpoTickets([row('a', 'tok-a')], [
      {
        status: 'error',
        message: 'device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);
    expect(out.sent).toEqual([]);
    expect(out.dead).toHaveLength(1);
    expect(out.dead[0].id).toBe('a');
    expect(out.dead[0].reason).toContain('DeviceNotRegistered');
    expect(out.deadTokens).toEqual(['tok-a']);
  });

  it('dedupes deadTokens across rows sharing a token', () => {
    const dnr = { status: 'error', details: { error: 'DeviceNotRegistered' } };
    const out = classifyExpoTickets(
      [row('a', 'tok-same'), row('b', 'tok-same'), row('c', 'tok-other')],
      [dnr, dnr, dnr],
    );
    expect(out.dead.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(out.deadTokens).toEqual(['tok-same', 'tok-other']);
  });

  it('MessageRateExceeded -> failed (retry), even when retries are nearly exhausted', () => {
    const out = classifyExpoTickets([row('a', 'tok-a', 2, 3)], [
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    expect(out.failed.map((f) => f.id)).toEqual(['a']);
    expect(out.dead).toEqual([]);
    expect(out.deadTokens).toEqual([]);
  });

  it('other errors -> failed while retries remain', () => {
    const out = classifyExpoTickets([row('a', 'tok-a', 0, 3)], [
      { status: 'error', message: 'boom', details: { error: 'InvalidCredentials' } },
    ]);
    expect(out.failed).toEqual([{ id: 'a', reason: 'InvalidCredentials: boom' }]);
    expect(out.dead).toEqual([]);
  });

  it('other errors -> dead when retry_count+1 >= max_retries', () => {
    const out = classifyExpoTickets([row('a', 'tok-a', 2, 3)], [
      { status: 'error', details: { error: 'SomethingElse' } },
    ]);
    expect(out.dead.map((d) => d.id)).toEqual(['a']);
    expect(out.failed).toEqual([]);
    expect(out.deadTokens).toEqual([]);
  });

  it('MessageTooBig is terminal regardless of retries', () => {
    const out = classifyExpoTickets([row('a', 'tok-a', 0, 3)], [
      { status: 'error', details: { error: 'MessageTooBig' } },
    ]);
    expect(out.dead.map((d) => d.id)).toEqual(['a']);
    expect(out.deadTokens).toEqual([]);
  });

  it('missing ticket (short response) -> failed with retry', () => {
    const out = classifyExpoTickets([row('a', 'tok-a'), row('b', 'tok-b')], [{ status: 'ok' }]);
    expect(out.sent).toEqual(['a']);
    expect(out.failed.map((f) => f.id)).toEqual(['b']);
  });

  it('mixed batch is partitioned by ticket, not by batch', () => {
    const out = classifyExpoTickets(
      [row('a', 't1'), row('b', 't2'), row('c', 't3', 2, 3), row('d', 't4')],
      [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'InvalidCredentials' } },
        { status: 'error', details: { error: 'MessageRateExceeded' } },
      ],
    );
    expect(out.sent).toEqual(['a']);
    expect(out.dead.map((d) => d.id).sort()).toEqual(['b', 'c']);
    expect(out.failed.map((f) => f.id)).toEqual(['d']);
    expect(out.deadTokens).toEqual(['t2']);
  });
});

describe('backoffSeconds', () => {
  it('keeps the 30s * 2^(n-1) schedule', () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
  });
});

describe('gameChanged', () => {
  const base = {
    espn_id: '401',
    home_team_id: 'h',
    away_team_id: 'a',
    home_score: 10,
    away_score: 7,
    venue_name: 'Stadium',
    scheduled_at: '2026-09-25T20:00:00+00:00',
    status: 'in',
    sport_id: 'nfl',
    metadata: { espn_id: '401', period: 2, display_clock: '8:42', home_linescore: [3, 7] },
  };

  it('undefined existing -> true', () => {
    expect(gameChanged(undefined, { ...base })).toBe(true);
  });

  it('identical rows -> false', () => {
    expect(gameChanged({ ...base }, { ...base })).toBe(false);
  });

  it('score change -> true', () => {
    expect(gameChanged({ ...base }, { ...base, home_score: 13 })).toBe(true);
  });

  it('status change -> true', () => {
    expect(gameChanged({ ...base }, { ...base, status: 'post' })).toBe(true);
  });

  it('metadata deep-equal with different key order -> false', () => {
    const existing = {
      ...base,
      metadata: { home_linescore: [3, 7], display_clock: '8:42', period: 2, espn_id: '401' },
    };
    expect(gameChanged(existing, { ...base })).toBe(false);
  });

  it('metadata value change -> true', () => {
    expect(
      gameChanged({ ...base }, { ...base, metadata: { ...base.metadata, period: 3 } }),
    ).toBe(true);
  });

  it('scheduled_at change -> true', () => {
    expect(gameChanged({ ...base }, { ...base, scheduled_at: '2026-09-26T20:00:00+00:00' })).toBe(
      true,
    );
  });

  it('scheduled_at same instant in ESPN vs Postgres spelling -> false', () => {
    expect(gameChanged({ ...base }, { ...base, scheduled_at: '2026-09-25T20:00Z' })).toBe(false);
  });

  it('ignores updated_at / created_at in next', () => {
    expect(
      gameChanged({ ...base }, { ...base, updated_at: '2026-09-25T21:00:00Z', created_at: 'x' }),
    ).toBe(false);
  });

  it('null vs undefined scalars are equal; null vs value is a change', () => {
    expect(gameChanged({ ...base, home_score: null }, { ...base, home_score: undefined })).toBe(
      false,
    );
    expect(gameChanged({ ...base, home_score: null }, { ...base })).toBe(true);
  });

  it('only compares keys present in next', () => {
    expect(gameChanged({ ...base, extra_column: 'ignored' }, { ...base })).toBe(false);
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[1,{"y":2,"z":1}],"d":2},"b":1}',
    );
  });
});
