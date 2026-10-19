import { describe, expect, it } from 'vitest';
import {
  IMPORT_RATE_LIMIT,
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
