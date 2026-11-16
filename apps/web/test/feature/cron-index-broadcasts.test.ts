import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/cron/index-broadcasts/route';
import type { BroadcastRunner } from '../../src/server/broadcast-runner';
import {
  compressedDump,
  dumpResponse,
  rutaMonth,
} from '../fixtures/broadcast-dumps';
import { fakeLichess, fide, fideSettled, monthsBack } from './support/fide';
import { fideStoreOn } from '../../src/server/fide-store';
import { useRequestHarness } from './support/harness';
import { testDb } from './support/request';

vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/fide-services', async () =>
  (await import('./support/fide')).fideServicesMock(),
);

const { sql } = useRequestHarness();

/** The real composition, past this file's mock of its module. */
const { composeFideServices } = await vi.importActual<
  typeof import('../../src/server/fide-services')
>('../../src/server/fide-services');

const SECRET = 'cron-secret-cron-secret-cron-secret-00';
const ROUTE = 'http://localhost/api/cron/index-broadcasts';
const MONTHS = monthsBack('2026-10', 14);

/**
 * The services of one server process, on the test database, Lichess
 * publishing `months`.
 */
function serverProcess(months: readonly string[] = MONTHS): BroadcastRunner {
  const fetch = fakeLichess({
    months,
    player: () => new Response('', { status: 404 }),
    dumps: Object.fromEntries(
      months.map((m) => [
        m,
        () => dumpResponse(compressedDump(rutaMonth(m))).response,
      ]),
    ),
  });
  fide.composed = composeFideServices({
    store: fideStoreOn(testDb()),
    fetch,
    token: undefined,
    secret: 'a-feature-test-secret-of-32-characters!!',
  });
  return fide.composed.runner;
}

const call = (authorization: string): Promise<Response> =>
  GET(new Request(ROUTE, { headers: { authorization } }));

const dumpsFetched = () => fide.fetched.filter((url) => url.endsWith('.zst'));

beforeEach(() => {
  fide.fetched = [];
  vi.stubEnv('CRON_SECRET', SECRET);
});

afterEach(async () => {
  await fideSettled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/index-broadcasts (#354, R-195)', () => {
  it('indexes the 12 newest months in the background, then finds nothing left to do', async () => {
    const runner = serverProcess();

    const first = await call(`Bearer ${SECRET}`);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      queued: 12,
      ready: 0,
      community: 'off',
    });
    await runner.settled();

    expect(dumpsFetched()).toHaveLength(12);
    expect(
      await sql.rows(
        "select month from broadcast_months where state = 'done' order by month desc",
      ),
    ).toEqual(MONTHS.slice(0, 12).map((month) => ({ month })));

    const second = await call(`Bearer ${SECRET}`);
    expect(await second.json()).toMatchObject({
      queued: 0,
      ready: 12,
      community: 'off',
    });
    await runner.settled();
    expect(dumpsFetched()).toHaveLength(12);
  });

  it('prunes a month that left the window, with its games, once Lichess publishes a newer one (#344)', async () => {
    // The prune goes by today's month (broadcastPruneWindow): a fixed one.
    vi.useFakeTimers({
      now: new Date('2026-11-16T03:00:00Z'),
      toFake: ['Date'],
    });
    const before = monthsBack('2026-09', 14);
    const runner = serverProcess(before);
    await call(`Bearer ${SECRET}`);
    await runner.settled();
    expect(await sql.count("broadcast_months where month = '2025-10'")).toBe(1);
    expect(await sql.count("broadcast_games where month = '2025-10'")).toBe(2);

    // A month later: 2025-10 is no longer one of the 12 newest.
    const next = serverProcess();
    const response = await call(`Bearer ${SECRET}`);
    expect(await response.json()).toMatchObject({
      queued: 1,
      ready: 11,
      pruned: { months: 1, tours: 0 },
    });
    await next.settled();
    expect(await sql.count("broadcast_months where month = '2025-10'")).toBe(0);
    expect(await sql.count("broadcast_games where month = '2025-10'")).toBe(0);
    expect(await sql.count('broadcast_months')).toBe(12);
  });

  it('refuses a wrong secret without reading Lichess', async () => {
    serverProcess();

    const response = await call('Bearer not-the-secret');

    expect(response.status).toBe(401);
    expect(fide.fetched).toEqual([]);
  });
});
