import { disableAccount } from '@mychess/db';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildTestAuth, signInByMagicLink } from './support/auth';

const { db, client } = useTestDatabase();
const DAY = 86_400_000;

const sessionRows = z.array(z.object({ expires_at: z.coerce.date() }));

// The one session's expiry, in epoch milliseconds.
const expiry = async (): Promise<number> => {
  const result = await client.query<Record<string, unknown>>(
    'select expires_at from sessions',
  );
  const [only, ...others] = sessionRows.parse(result.rows);
  if (only === undefined || others.length > 0)
    throw new Error(
      `expected one session, found ${String(result.rows.length)}`,
    );
  return only.expires_at.getTime();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('sessions (R-80)', () => {
  it('last 90 days', async () => {
    const built = buildTestAuth(db);
    const before = Date.now();
    await signInByMagicLink(built, 'ruta@example.lt');
    expect(await expiry()).toBeGreaterThanOrEqual(before + 90 * DAY - 1000);
    expect(await expiry()).toBeLessThanOrEqual(Date.now() + 90 * DAY + 1000);
  });

  it('are renewed by a visit more than a day later', async () => {
    const built = buildTestAuth(db);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const first = await expiry();
    vi.useFakeTimers({ now: Date.now() + 2 * DAY, toFake: ['Date'] });
    await built.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(await expiry()).toBeGreaterThanOrEqual(first + 2 * DAY - 1000);
  });

  it('are not renewed by a visit within the day', async () => {
    const built = buildTestAuth(db);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const first = await expiry();
    vi.useFakeTimers({ now: Date.now() + DAY / 2, toFake: ['Date'] });
    await built.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(await expiry()).toBe(first);
  });

  it('end at once when the account is disabled, and no new one starts (security item 8)', async () => {
    const built = buildTestAuth(db);
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    await disableAccount(db, {
      email: 'ruta@example.lt',
      actor: 'cli',
      now: new Date(),
      key: TEST_AUDIT_EMAIL_KEY,
    });
    expect(
      await built.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
    await expect(
      signInByMagicLink(built, 'ruta@example.lt'),
    ).resolves.not.toMatch(/session_token=[^;]+\./);
    expect(
      (await client.query('select count(*)::int as n from sessions')).rows,
    ).toEqual([{ n: 0 }]);
  });
});
