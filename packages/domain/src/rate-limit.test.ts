import { describe, expect, it } from 'vitest';
import {
  IMPORT_RATE_LIMIT,
  MAGIC_LINK_RATE_LIMIT,
  RATE_LIMIT_RETENTION_MS,
  countRequest,
  importRateKey,
  type RateCounter,
  type RateRule,
} from './rate-limit';

const RULE: RateRule<'x.tooMany'> = {
  windowMs: 60_000,
  max: 3,
  reason: 'x.tooMany',
};
const T0 = 1_000_000;

describe('countRequest', () => {
  it('allows a first request and opens a window at it', () => {
    expect(countRequest(undefined, RULE, T0)).toEqual({
      ok: true,
      value: { count: 1, windowStart: T0 },
    });
  });

  it('counts requests within the window up to the maximum, keeping its start', () => {
    const counter = { count: 2, windowStart: T0 };
    expect(countRequest(counter, RULE, T0 + 1000)).toEqual({
      ok: true,
      value: { count: 3, windowStart: T0 },
    });
  });

  it('refuses a request over the maximum within the window, naming it', () => {
    const counter = { count: 3, windowStart: T0 };
    expect(countRequest(counter, RULE, T0 + RULE.windowMs - 1)).toEqual({
      ok: false,
      refusal: { reason: 'x.tooMany', limit: 3 },
    });
  });

  it('opens a new window once a whole window has passed since its start', () => {
    const counter = { count: 3, windowStart: T0 };
    expect(countRequest(counter, RULE, T0 + RULE.windowMs)).toEqual({
      ok: true,
      value: { count: 1, windowStart: T0 + RULE.windowMs },
    });
  });

  it('never refuses a steady pace under the maximum, however long it lasts', () => {
    const rule: RateRule<'x.tooMany'> = { ...RULE, max: 10 };
    let counter: RateCounter | undefined;
    for (let ms = 0; ms < 10 * 60_000; ms += 30_000) {
      const counted = countRequest(counter, rule, T0 + ms);
      if (!counted.ok) throw new Error(`refused at ${String(ms)} ms`);
      counter = counted.value;
    }
    expect(counter).toEqual({ count: 2, windowStart: T0 + 9 * 60_000 });
  });
});

describe('the import limit (R-119)', () => {
  it('allows ten imports a minute, refused as too many imports', () => {
    expect(IMPORT_RATE_LIMIT).toEqual({
      windowMs: 60_000,
      max: 10,
      reason: 'pgn.tooManyImports',
    });
  });

  it('counts per account, one key for previews and confirms', () => {
    expect(importRateKey('acc-1')).toBe('pgn-import:acc-1');
    expect(importRateKey('acc-2')).not.toBe(importRateKey('acc-1'));
  });
});

describe('the magic-link limit (security A6)', () => {
  it('mails a sign-in link at most three times a minute', () => {
    expect(MAGIC_LINK_RATE_LIMIT).toEqual({ windowMs: 60_000, max: 3 });
  });
});

describe('RATE_LIMIT_RETENTION_MS', () => {
  it('is the longest window of any limit: a minute', () => {
    expect(RATE_LIMIT_RETENTION_MS).toBe(60_000);
    expect(RATE_LIMIT_RETENTION_MS).toBeGreaterThanOrEqual(
      IMPORT_RATE_LIMIT.windowMs,
    );
    expect(RATE_LIMIT_RETENTION_MS).toBeGreaterThanOrEqual(
      MAGIC_LINK_RATE_LIMIT.windowMs,
    );
  });

  it('outlives every counter: one older counts like no counter at all', () => {
    const now = T0 + RATE_LIMIT_RETENTION_MS + 1;
    const stale = { count: IMPORT_RATE_LIMIT.max, windowStart: T0 };
    expect(countRequest(stale, IMPORT_RATE_LIMIT, now)).toEqual(
      countRequest(undefined, IMPORT_RATE_LIMIT, now),
    );
  });
});
