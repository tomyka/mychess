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

/** Our counters, in their own table: Better Auth never prunes it. */
const rows = async (): Promise<unknown> =>
  (
    await client.query(
      'select key, count, window_start from request_counters order by key',
    )
  ).rows;

describe('countRateLimited', () => {
  it('allows up to the maximum in a window, then refuses without counting', async () => {
    expect(await countRateLimited(db, 'k', RULE, T0)).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'k', RULE, at(1000))).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'k', RULE, at(2000))).toEqual(REFUSED);
    expect(await rows()).toEqual([
      { key: 'k', count: 2, window_start: String(T0.getTime()) },
    ]);
  });

  it("writes nothing to Better Auth's rate_limits table", async () => {
    await countRateLimited(db, 'k', RULE, T0);
    expect(
      (await client.query('select count(*)::int as n from rate_limits')).rows,
    ).toEqual([{ n: 0 }]);
  });

  it('counts each key on its own', async () => {
    await countRateLimited(db, 'a', RULE, T0);
    await countRateLimited(db, 'a', RULE, T0);
    expect(await countRateLimited(db, 'b', RULE, T0)).toEqual(ALLOWED);
    expect(await countRateLimited(db, 'a', RULE, T0)).toEqual(REFUSED);
  });

  it('opens a new window a whole window after the last one opened', async () => {
    await countRateLimited(db, 'k', RULE, T0);
    await countRateLimited(db, 'k', RULE, at(RULE.windowMs - 1));
    expect(await countRateLimited(db, 'k', RULE, at(RULE.windowMs))).toEqual(
      ALLOWED,
    );
    expect(await rows()).toEqual([
      {
        key: 'k',
        count: 1,
        window_start: String(T0.getTime() + RULE.windowMs),
      },
    ]);
  });

  it('never refuses a steady pace at the maximum a window', async () => {
    const outcomes = [];
    for (let ms = 0; ms < 10 * RULE.windowMs; ms += RULE.windowMs / 2) {
      outcomes.push(await countRateLimited(db, 'k', RULE, at(ms)));
    }
    expect(outcomes).toHaveLength(20);
    expect(outcomes.every((o) => o.ok)).toBe(true);
  });

  it('never lets concurrent requests past the maximum', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => countRateLimited(db, 'k', RULE, T0)),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
  });
});
