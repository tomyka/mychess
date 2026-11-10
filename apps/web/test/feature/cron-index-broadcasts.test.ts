import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/cron/index-broadcasts/route';
import {
  broadcastIndexOn,
  createBroadcastRunner,
  type BroadcastRunner,
} from '../../src/server/broadcast-runner';
import { createBroadcastSources } from '../../src/server/broadcast-sources';
import {
  compressedDump,
  dumpResponse,
  rutaMonth,
} from '../fixtures/broadcast-dumps';
import { fakeLichess, fide, monthsBack } from './support/fide';
import { useRequestHarness } from './support/harness';
import { testDb } from './support/request';

vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/fide-services', async () =>
  (await import('./support/fide')).fideServicesMock(),
);

const { sql } = useRequestHarness();

const SECRET = 'cron-secret-cron-secret-cron-secret-00';
const ROUTE = 'http://localhost/api/cron/index-broadcasts';
const MONTHS = monthsBack('2026-10', 14);

/** The services of one server process, on the test database. */
function serverProcess(): BroadcastRunner {
  const fetch = fakeLichess({
    months: MONTHS,
    player: () => new Response('', { status: 404 }),
    dumps: Object.fromEntries(
      MONTHS.map((m) => [
        m,
        () => dumpResponse(compressedDump(rutaMonth(m))).response,
      ]),
    ),
  });
  const clock = () => new Date();
  const runner = createBroadcastRunner({
    index: broadcastIndexOn(testDb()),
    fetch,
    clock,
  });
  fide.services = {
    runner,
    sources: createBroadcastSources({ fetch, clock }),
    secret: 'a-feature-test-secret-of-32-characters!!',
  };
  return runner;
}

const call = (authorization: string): Promise<Response> =>
  GET(new Request(ROUTE, { headers: { authorization } }));

const dumpsFetched = () => fide.fetched.filter((url) => url.endsWith('.zst'));

beforeEach(() => {
  fide.fetched = [];
  vi.stubEnv('CRON_SECRET', SECRET);
});

afterEach(async () => {
  await fide.services?.runner.settled();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/index-broadcasts (#354, R-195)', () => {
  it('indexes the 12 newest months in the background, then finds nothing left to do', async () => {
    const runner = serverProcess();

    const first = await call(`Bearer ${SECRET}`);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ queued: 12, ready: 0 });
    await runner.settled();

    expect(dumpsFetched()).toHaveLength(12);
    expect(
      await sql.rows(
        "select month from broadcast_months where state = 'done' order by month desc",
      ),
    ).toEqual(MONTHS.slice(0, 12).map((month) => ({ month })));

    const second = await call(`Bearer ${SECRET}`);
    expect(await second.json()).toEqual({ queued: 0, ready: 12 });
    await runner.settled();
    expect(dumpsFetched()).toHaveLength(12);
  });

  it('refuses a wrong secret without reading Lichess', async () => {
    serverProcess();

    const response = await call('Bearer not-the-secret');

    expect(response.status).toBe(401);
    expect(fide.fetched).toEqual([]);
  });
});
