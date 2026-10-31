import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/cron/prune-rate-limits/route';

const { client, url } = useTestDatabase();

const SECRET = 'cron-secret-cron-secret-cron-secret-00';
const ROUTE = 'http://localhost/api/cron/prune-rate-limits';

const call = (authorization?: string): Promise<Response> =>
  GET(
    new Request(
      ROUTE,
      authorization === undefined ? {} : { headers: { authorization } },
    ),
  );

const authKeys = async (): Promise<string[]> =>
  (
    await client.query<{ key: string }>(
      'select key from rate_limits order by key',
    )
  ).rows.map((r) => r.key);

beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('CRON_SECRET', SECRET);
  const now = Date.now();
  // A row a minute past its window, and one still deciding requests.
  for (const [key, lastRequest] of [
    ['stale', now - 10 * 60_000],
    ['fresh', now],
  ] as const)
    await client.query(
      'insert into rate_limits (id, key, count, last_request) values ($1, $1, 1, $2)',
      [key, lastRequest],
    );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/prune-rate-limits (#234)', () => {
  it("prunes with Vercel Cron's bearer secret and says how many rows went", async () => {
    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ pruned: 1 });
    expect(await authKeys()).toEqual(['fresh']);
  });

  it.each([
    ['no authorization', undefined],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
  ])('refuses %s with 401 and prunes nothing', async (_, authorization) => {
    const response = await call(authorization);

    expect(response.status).toBe(401);
    expect(await authKeys()).toEqual(['fresh', 'stale']);
  });

  it('does not exist where CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', undefined);

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(404);
    expect(await authKeys()).toEqual(['fresh', 'stale']);
  });
});
