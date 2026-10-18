import type { RateRule } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { countRateLimited } from '../src';
import { useTestDatabase } from '../src/testing';

const { db, client } = useTestDatabase();

const RULE: RateRule<'x.tooMany'> = {
  windowMs: 60_000,
  max: 2,
  reason: 'x.tooMany',
};
const T0 = new Date('2026-10-19T08:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const ALLOWED = { ok: true, value: undefined };
const REFUSED = { ok: false, refusal: { reason: 'x.tooMany', limit: 2 } };

const rows = async (): Promise<unknown> =>
  (
    await client.query(
      'select key, count, last_request from rate_limits order by key',
    )
  ).rows;

describe('countRateLimited', () => {
  it('allows up to the maximum in a window, then refuses without counting', async () => {
    expect(await countRateLimited(db, 'k', RULE, T0)).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'k', RULE, at(1000))).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'k', RULE, at(2000))).toEqual(REFUSED);
    expect(await rows()).toEqual([
      { key: 'k', count: 2, last_request: String(T0.getTime() + 1000) },
    ]);
  });

  it('counts each key on its own', async () => {
    await countRateLimited(db, 'a', RULE, T0);
    await countRateLimited(db, 'a', RULE, T0);
    expect(await countRateLimited(db, 'b', RULE, T0)).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'a', RULE, T0)).toEqual(REFUSED);
  });

  it('starts again a whole window after the last allowed request', async () => {
    await countRateLimited(db, 'k', RULE, T0);
    await countRateLimited(db, 'k', RULE, T0);
    expect(await countRateLimited(db, 'k', RULE, at(RULE.windowMs))).toEqual(
      ALLOWED,
    );
    expect(await rows()).toEqual([
      {
        key: 'k',
        count: 1,
        last_request: String(T0.getTime() + RULE.windowMs),
      },
    ]);
  });

  it('never lets concurrent requests past the maximum', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => countRateLimited(db, 'k', RULE, T0)),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
  });
});
