import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastMonthSchema } from '@mychess/domain';
import {
  pollFideSearchAction,
  startFideSearchAction,
} from '../../src/app/fide/actions';
import {
  broadcastIndexOn,
  createBroadcastRunner,
  type BroadcastRunner,
} from '../../src/server/broadcast-runner';
import { createBroadcastSources } from '../../src/server/broadcast-sources';
import type {
  FidePollState,
  FideSearchState,
  StartedSearch,
} from '../../src/server/fide-search';
import {
  compressedDump,
  dumpResponse,
  RUTA_FIDE_ID,
  rutaMonth,
} from '../fixtures/broadcast-dumps';
import { actAs, formOf, person, type Person } from './support/coaching';
import { fakeLichess, fide, monthsBack } from './support/fide';
import { useRequestHarness } from './support/harness';
import { outcomeOf, testDb } from './support/request';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);
vi.mock('../../src/server/fide-services', async () =>
  (await import('./support/fide')).fideServicesMock(),
);

const { sql } = useRequestHarness();

const SECRET = 'a-feature-test-secret-of-32-characters!!';
const MONTHS = monthsBack('2026-10', 13);
const SEARCHED = MONTHS.slice(0, 12);
const ID = String(RUTA_FIDE_ID);

const PLAYER = () =>
  Response.json({
    id: RUTA_FIDE_ID,
    name: 'Pavyzdyte, Ruta',
    federation: 'LTU',
    standard: 2105,
  });

type Dumps = Parameters<typeof fakeLichess>[0]['dumps'];

const goodDumps = (months: readonly string[]): Dumps =>
  Object.fromEntries(
    months.map((m) => [
      m,
      () => dumpResponse(compressedDump(rutaMonth(m))).response,
    ]),
  );

/** The services of one server process, on the test database. */
function serverProcess(dumps: Dumps): BroadcastRunner {
  const fetch = fakeLichess({ months: MONTHS, player: PLAYER, dumps });
  const clock = () => new Date();
  const runner = createBroadcastRunner({
    index: broadcastIndexOn(testDb()),
    fetch,
    clock,
  });
  fide.services = {
    runner,
    sources: createBroadcastSources({ fetch, clock }),
    secret: SECRET,
  };
  return runner;
}

const dumpsFetched = () => fide.fetched.filter((url) => url.endsWith('.zst'));

async function start(raw = ID): Promise<FideSearchState> {
  return startFideSearchAction({ kind: 'idle' }, formOf({ fideId: raw }));
}

async function started(raw = ID): Promise<StartedSearch> {
  const state = await start(raw);
  if (state.kind !== 'started') throw new Error(JSON.stringify(state));
  return state.search;
}

async function polled(token: string): Promise<FidePollState> {
  return pollFideSearchAction(token);
}

const logs = {
  error: vi.spyOn(console, 'error'),
  warn: vi.spyOn(console, 'warn'),
  log: vi.spyOn(console, 'log'),
  info: vi.spyOn(console, 'info'),
};

let ruta: Person;

beforeEach(async () => {
  fide.fetched = [];
  for (const spy of Object.values(logs))
    spy.mockReset().mockImplementation(() => undefined);
  ruta = await person(sql, 'ruta@example.lt', 'Rūta');
  actAs(ruta);
});

afterEach(async () => {
  await fide.services?.runner.settled();
});

describe('a FIDE ID search (#316)', () => {
  it('indexes the 12 newest months in the background, then answers from the index alone', async () => {
    const runner = serverProcess(goodDumps(MONTHS));
    const first = await started();
    expect(first.player).toEqual({
      name: 'Pavyzdyte, Ruta',
      federation: 'LTU',
      title: null,
      standardRating: 2105,
    });
    expect(first.snapshot.progress).toEqual({
      total: 12,
      ready: 0,
      waiting: 12,
      unavailable: 0,
    });
    await runner.settled();
    expect(dumpsFetched()).toHaveLength(12);
    expect(dumpsFetched().some((url) => url.includes(MONTHS[12] ?? ''))).toBe(
      false,
    );

    const progress = await polled(first.token);
    expect(progress).toMatchObject({
      kind: 'progress',
      snapshot: {
        progress: { total: 12, ready: 12, waiting: 0, unavailable: 0 },
        truncated: false,
      },
    });
    const games = progress.kind === 'progress' ? progress.snapshot.games : [];
    expect(games).toHaveLength(24);
    expect(games.slice(0, 2)).toEqual([
      expect.objectContaining({
        date: '2026-10-15',
        colour: 'black',
        outcome: 'draw',
        opponent: { name: 'Kitas, Petras', fideId: null },
      }),
      expect.objectContaining({
        date: '2026-10-14',
        colour: 'white',
        outcome: 'win',
        opponent: { name: 'Testas, Jonas', fideId: 90_000_002 },
        url: 'https://lichess.org/broadcast/synthetic/round-1/w202610',
      }),
    ]);

    // A second search, of any ID, downloads nothing more.
    const second = await started('90000002');
    expect(second.snapshot.progress.ready).toBe(12);
    expect(second.snapshot.games).toHaveLength(12);
    await runner.settled();
    expect(dumpsFetched()).toHaveLength(12);
  });

  it('shows a month that keeps failing as waiting, then unavailable after its third attempt', async () => {
    const broken = SEARCHED[3] ?? '';
    const runner = serverProcess({
      ...goodDumps(MONTHS),
      [broken]: () => new Response('', { status: 500 }),
    });
    const { token } = await started();
    await runner.settled();
    // Just after a failure the month waits (R-188), and is not retried.
    let state = await polled(token);
    expect(state).toMatchObject({
      snapshot: { progress: { ready: 11, waiting: 1, unavailable: 0 } },
    });
    await runner.settled();
    expect(dumpsFetched().filter((url) => url.includes(broken))).toHaveLength(
      1,
    );
    // Each retry comes 10 minutes after the last failure.
    vi.useFakeTimers({ now: new Date(), toFake: ['Date'] });
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      vi.setSystemTime(Date.now() + 11 * 60_000);
      await polled(token);
      await runner.settled();
    }
    state = await polled(token);
    vi.useRealTimers();
    expect(state).toMatchObject({
      kind: 'progress',
      snapshot: {
        progress: { total: 12, ready: 11, waiting: 0, unavailable: 1 },
      },
    });
    await runner.settled();
    expect(dumpsFetched().filter((url) => url.includes(broken))).toHaveLength(
      3,
    );
    expect(
      await sql.rows(
        'select state, attempts from broadcast_months where month = $1',
        [broken],
      ),
    ).toEqual([{ state: 'failed', attempts: 3 }]);
  });

  it('downloads a month once when two processes need it at the same time', async () => {
    const other = createBroadcastRunner({
      index: broadcastIndexOn(testDb()),
      fetch: fakeLichess({
        months: MONTHS,
        player: PLAYER,
        dumps: goodDumps(MONTHS),
      }),
      clock: () => new Date(),
    });
    const runner = serverProcess(goodDumps(MONTHS));
    const month = broadcastMonthSchema.parse(SEARCHED[0]);
    runner.need([month]);
    other.need([month]);
    await Promise.all([runner.settled(), other.settled()]);
    expect(dumpsFetched()).toHaveLength(1);
  });

  it('counts only search starts: polls never use up the limit', async () => {
    serverProcess(goodDumps(MONTHS));
    const { token } = await started();
    for (let n = 0; n < 15; n += 1) {
      expect((await polled(token)).kind).toBe('progress');
    }
    for (let n = 2; n <= 10; n += 1)
      expect((await start()).kind).toBe('started');
    expect(await start()).toEqual({
      kind: 'refused',
      refusal: 'fide.tooManySearches',
      limit: 10,
    });
  });

  it('refuses an ID that is no FIDE ID without counting it', async () => {
    serverProcess(goodDumps(MONTHS));
    expect(await start('12a')).toEqual({
      kind: 'refused',
      refusal: 'fide.idInvalid',
    });
    expect(
      await sql.count("request_counters where key like 'fide-search:%'"),
    ).toBe(0);
    expect(fide.fetched).toEqual([]);
  });

  it('lets no one else follow a search with its token', async () => {
    serverProcess(goodDumps(MONTHS));
    const { token } = await started();
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(await polled(token)).toEqual({ kind: 'expired' });
  });

  it('sends a signed-out visitor to sign-in, counting and fetching nothing', async () => {
    serverProcess(goodDumps(MONTHS));
    actAs({ id: '', cookie: '' });
    expect(await outcomeOf(start())).toEqual({ redirectedTo: '/prisijungti' });
    expect(await outcomeOf(polled('x.y'))).toEqual({
      redirectedTo: '/prisijungti',
    });
    expect(
      await sql.count("request_counters where key like 'fide-search:%'"),
    ).toBe(0);
    expect(fide.fetched).toEqual([]);
  });

  it('writes no log line holding the searched ID, failures included', async () => {
    const runner = serverProcess({
      ...goodDumps(MONTHS),
      [SEARCHED[0] ?? '']: () => new Response('', { status: 500 }),
    });
    const { token } = await started();
    await runner.settled();
    await polled(token);
    await runner.settled();
    const lines = Object.values(logs).flatMap((spy) =>
      spy.mock.calls.map((call) => JSON.stringify(call)),
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.includes(ID))).toEqual([]);
  });
});
