import { describe, expect, it } from 'vitest';
import {
  IMPORT_RATE_LIMIT,
  countRequest,
  importRateKey,
  type RateRule,
} from './rate-limit';

const RULE: RateRule<'x.tooMany'> = {
  windowMs: 60_000,
  max: 3,
  reason: 'x.tooMany',
};
const T0 = 1_000_000;

describe('countRequest', () => {
  it('allows a first request and starts the count at one', () => {
    expect(countRequest(undefined, RULE, T0)).toEqual({
      ok: true,
      value: { count: 1, lastRequest: T0 },
    });
  });

  it('counts requests within the window up to the maximum', () => {
    const counter = { count: 2, lastRequest: T0 };
    expect(countRequest(counter, RULE, T0 + 1000)).toEqual({
      ok: true,
      value: { count: 3, lastRequest: T0 + 1000 },
    });
  });

  it('refuses a request over the maximum within the window, naming it', () => {
    const counter = { count: 3, lastRequest: T0 };
    expect(countRequest(counter, RULE, T0 + RULE.windowMs - 1)).toEqual({
      ok: false,
      refusal: { reason: 'x.tooMany', limit: 3 },
    });
  });

  it('starts again once a whole window has passed since the last request', () => {
    const counter = { count: 3, lastRequest: T0 };
    expect(countRequest(counter, RULE, T0 + RULE.windowMs)).toEqual({
      ok: true,
      value: { count: 1, lastRequest: T0 + RULE.windowMs },
    });
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
