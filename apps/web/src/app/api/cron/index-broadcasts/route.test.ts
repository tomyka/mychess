import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreindexCounts } from '../../../../server/broadcast-preindex';
import { GET } from './route';

const SECRET = 'cron-secret-cron-secret-cron-secret-00';
const ROUTE = 'http://localhost/api/cron/index-broadcasts';
const NOW = new Date('2026-11-10T03:00:00Z');

const server = vi.hoisted(() => ({
  preindex: vi.fn<(now: Date) => Promise<PreindexCounts>>(),
}));

// What the upkeep does is broadcast-preindex.test.ts's; here only that
// the route guards it, calls it at `now` and answers with its counts.
vi.mock('../../../../server/fide-services', () => ({
  fideServices: () => ({ preindex: server.preindex }),
}));

const call = (authorization?: string): Promise<Response> =>
  GET(
    new Request(
      ROUTE,
      authorization === undefined ? {} : { headers: { authorization } },
    ),
  );

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.preindex.mockReset().mockResolvedValue({
    queued: 12,
    ready: 0,
    community: 'started',
    pruned: { months: 1, tours: 0 },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/index-broadcasts (#354, R-195; #349)', () => {
  it('runs the nightly upkeep and answers 202 with its counts, never cached', async () => {
    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      queued: 12,
      ready: 0,
      community: 'started',
      pruned: { months: 1, tours: 0 },
    });
    expect(server.preindex).toHaveBeenCalledExactlyOnceWith(NOW);
  });

  it.each([
    ['no authorization', undefined],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
  ])('refuses %s with 401 and runs nothing', async (_, authorization) => {
    const response = await call(authorization);

    expect(response.status).toBe(401);
    expect(server.preindex).not.toHaveBeenCalled();
  });

  it('does not exist where CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', undefined);

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(404);
    expect(server.preindex).not.toHaveBeenCalled();
  });

  it('fails when the upkeep cannot read the month list', async () => {
    server.preindex.mockRejectedValue(new Error('lichess down'));

    await expect(call(`Bearer ${SECRET}`)).rejects.toThrow('lichess down');
  });
});
