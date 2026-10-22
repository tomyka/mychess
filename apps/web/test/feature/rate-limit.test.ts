import { useTestDatabase } from '@mychess/db/testing';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTestAuth,
  type BuiltAuth,
  requestMagicLink,
  signInByMagicLink,
} from './support/auth';

const { db, client } = useTestDatabase();

/** A magic-link request from the client at `ip`, as Vercel forwards it. */
function requestLink(
  built: BuiltAuth,
  email: string,
  ip: Record<string, string>,
): Promise<Response> {
  return requestMagicLink(built, { email, callbackURL: '/' }, ip);
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

  it('lets the client address ask again once the minute has passed', async () => {
    const built = buildTestAuth(db);
    await statuses(built, THREE, forwardedFor('203.0.113.7'));
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    expect(
      (await requestLink(built, 'd@example.lt', forwardedFor('203.0.113.7')))
        .status,
    ).toBe(200);
  });
});

/** The `n`th client address of a block no other test uses. */
const clientAt = (n: number) => forwardedFor(`198.51.100.${String(n)}`);

/** Asks for `count` links for `email`, each from its own client address. */
async function fromManyAddresses(
  built: BuiltAuth,
  email: string,
  count: number,
  first = 1,
): Promise<Response[]> {
  const answers: Response[] = [];
  for (let n = first; n < first + count; n++)
    answers.push(await requestLink(built, email, clientAt(n)));
  return answers;
}

const answerOf = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
});

const statusesOf = (responses: readonly Response[]) =>
  responses.map((r) => r.status);

describe('the magic-link limit per email (#264)', () => {
  it('refuses a 6th link for one email in an hour with 429, even from other client addresses, mailing nothing', async () => {
    const built = buildTestAuth(db);
    expect(
      statusesOf(await fromManyAddresses(built, 'a@example.lt', 6)),
    ).toEqual([200, 200, 200, 200, 200, 429]);
    expect(built.sent).toHaveLength(5);
  });

  it('counts the canonical email, whichever form the request types', async () => {
    const built = buildTestAuth(db);
    await fromManyAddresses(built, 'a@example.lt', 5);
    const refused = await requestLink(built, ' A@Example.LT ', clientAt(99));
    expect(refused.status).toBe(429);
    expect(built.sent).toHaveLength(5);
  });

  it('counts each email on its own', async () => {
    const built = buildTestAuth(db);
    await fromManyAddresses(built, 'a@example.lt', 5);
    expect(
      (await requestLink(built, 'b@example.lt', clientAt(99))).status,
    ).toBe(200);
  });

  it('limits an email with no account exactly as one with an account', async () => {
    const built = buildTestAuth(db);
    await signInByMagicLink(built, 'known@example.lt');
    const known = await fromManyAddresses(built, 'known@example.lt', 5);
    const unknown = await fromManyAddresses(built, 'unknown@example.lt', 6, 10);
    expect(statusesOf(known)).toEqual([200, 200, 200, 200, 429]);
    expect(statusesOf(unknown)).toEqual([200, 200, 200, 200, 200, 429]);
    expect(await answerOf(known[4] ?? Response.error())).toEqual(
      await answerOf(unknown[5] ?? Response.error()),
    );
  });

  it('counts every plus-suffixed form of an address against one inbox', async () => {
    const built = buildTestAuth(db);
    for (let n = 1; n <= 5; n++)
      await requestLink(built, `a+${String(n)}@example.lt`, clientAt(n));
    expect(
      (await requestLink(built, 'a@example.lt', clientAt(99))).status,
    ).toBe(429);
    expect(built.sent).toHaveLength(5);
  });

  it('keeps each counter in its own table under the inbox hash, never the address', async () => {
    const built = buildTestAuth(db);
    await fromManyAddresses(built, 'a+news@example.lt', 2);
    const inboxHash = createHash('sha256').update('a@example.lt').digest('hex');
    const { rows } = await client.query<{ key: string; count: number }>(
      'select key, count from request_counters',
    );
    expect(rows).toEqual([{ key: `magic-link-email:${inboxHash}`, count: 2 }]);
    expect(JSON.stringify(rows)).not.toContain('example');
  });

  it('survives Better Auth pruning its own counters a minute on', async () => {
    const built = buildTestAuth(db);
    await fromManyAddresses(built, 'a@example.lt', 5);
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] });
    // An address seen a minute ago opens a new window: Better Auth then
    // deletes every rate_limits row older than its longest window.
    expect((await requestLink(built, 'b@example.lt', clientAt(1))).status).toBe(
      200,
    );
    expect((await client.query('select key from rate_limits')).rows).toEqual([
      { key: '198.51.100.1|/sign-in/magic-link' },
    ]);
    expect(
      (await requestLink(built, 'a@example.lt', clientAt(99))).status,
    ).toBe(429);
    expect(built.sent.map((m) => m.to).at(-1)).toBe('b@example.lt');
  });

  it('lets the email ask again once the hour has passed', async () => {
    const built = buildTestAuth(db);
    await fromManyAddresses(built, 'a@example.lt', 5);
    vi.useFakeTimers({ now: Date.now() + 3_601_000, toFake: ['Date'] });
    expect(
      (await requestLink(built, 'a@example.lt', clientAt(99))).status,
    ).toBe(200);
  });
});
