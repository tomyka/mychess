import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, buildTestAuth, type BuiltAuth } from './support/auth';

const { db, client } = useTestDatabase();

/** A magic-link request from the client at `ip`, as Vercel forwards it. */
function requestLink(
  built: BuiltAuth,
  email: string,
  ip: Record<string, string>,
): Promise<Response> {
  return built.auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...ip },
      body: JSON.stringify({ email, callbackURL: '/' }),
    }),
  );
}

const forwardedFor = (ip: string) => ({ 'x-forwarded-for': ip });
const realIp = (ip: string) => ({ 'x-real-ip': ip });

/** Asks for a link for each email in turn; returns the statuses. */
async function statuses(
  built: BuiltAuth,
  emails: readonly string[],
  ip: Record<string, string>,
): Promise<number[]> {
  const answers: number[] = [];
  for (const email of emails)
    answers.push((await requestLink(built, email, ip)).status);
  return answers;
}

const FOUR = ['a@example.lt', 'b@example.lt', 'c@example.lt', 'd@example.lt'];
const THREE = FOUR.slice(0, 3);

afterEach(() => {
  vi.useRealTimers();
});

// The suite runs with NODE_ENV=test, where Better Auth's own default leaves
// rate limiting off: these pass only because createAuth turns it on.
describe('rate limiting (security A6)', () => {
  it('answers a 4th magic-link request in a minute from one address with 429, mailing nothing', async () => {
    const built = buildTestAuth(db);
    expect(await statuses(built, FOUR, forwardedFor('203.0.113.7'))).toEqual([
      200, 200, 200, 429,
    ]);
    expect(built.sent.map((m) => m.to)).toEqual(THREE);
  });

  it('counts each address on its own', async () => {
    const built = buildTestAuth(db);
    await statuses(built, THREE, forwardedFor('203.0.113.7'));
    expect(
      (await requestLink(built, 'd@example.lt', forwardedFor('203.0.113.8')))
        .status,
    ).toBe(200);
  });

  it('reads the address from x-real-ip too', async () => {
    const built = buildTestAuth(db);
    expect(await statuses(built, FOUR, realIp('203.0.113.7'))).toEqual([
      200, 200, 200, 429,
    ]);
    expect(
      (await requestLink(built, 'd@example.lt', realIp('203.0.113.8'))).status,
    ).toBe(200);
  });

  it('keeps the counts in the database, so every server instance shares them', async () => {
    await statuses(buildTestAuth(db), THREE, forwardedFor('203.0.113.7'));
    const other = buildTestAuth(db);
    expect(
      (await requestLink(other, 'd@example.lt', forwardedFor('203.0.113.7')))
        .status,
    ).toBe(429);
    expect(other.sent).toEqual([]);
    expect(
      (await client.query('select key, count from rate_limits')).rows,
    ).toEqual([{ key: '203.0.113.7|/sign-in/magic-link', count: 3 }]);
  });

  it('lets the address ask again once the minute has passed', async () => {
    const built = buildTestAuth(db);
    await statuses(built, THREE, forwardedFor('203.0.113.7'));
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    expect(
      (await requestLink(built, 'd@example.lt', forwardedFor('203.0.113.7')))
        .status,
    ).toBe(200);
  });
});
