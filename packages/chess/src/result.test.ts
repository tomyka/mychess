import { describe, expect, it } from 'vitest';
import { ok, refuse, type Result } from './result';

describe('ok', () => {
  it('is a success with no value when given none', () => {
    const done: Result<undefined, never> = ok();
    expect(done).toEqual({ ok: true, value: undefined });
    expect(Object.keys(done)).toEqual(['ok', 'value']);
  });

  it('is a success carrying the value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });
});

describe('refuse', () => {
  it('is a refusal with the reason alone', () => {
    expect(refuse('pgn.noValidGames')).toStrictEqual({
      ok: false,
      refusal: { reason: 'pgn.noValidGames' },
    });
  });

  it('is a refusal with the reason and its details', () => {
    expect(refuse('pgn.tooLarge', { limit: 3 })).toStrictEqual({
      ok: false,
      refusal: { reason: 'pgn.tooLarge', limit: 3 },
    });
  });
});
