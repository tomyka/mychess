import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '@mychess/integrations';
import { startFideSearchAction } from '../../src/app/fide/actions';
import { GET } from '../../src/app/api/cron/index-broadcasts/route';
import type { ComposedFideServices } from '../../src/server/fide-services';
import type { StartedSearch } from '../../src/server/fide-search';
import {
  compressedDump,
  dumpResponse,
  RUTA_FIDE_ID,
  rutaMonth,
} from '../fixtures/broadcast-dumps';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  pgnPath,
  tourDetailJson,
  toursPageJson,
  tourPgn,
  type FakeTour,
} from '../fixtures/lichess-broadcast-api';
import { actAs, formOf, person } from './support/coaching';
import { fakeLichess, fide, fideSettled, monthsBack } from './support/fide';
import { fideStoreOn } from '../../src/server/fide-store';
import { useRequestHarness } from './support/harness';
import { testDb } from './support/request';

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

/** The real composition, past this file's mock of its module. */
const { composeFideServices } = await vi.importActual<
  typeof import('../../src/server/fide-services')
>('../../src/server/fide-services');

const CRON_SECRET = 'cron-secret-cron-secret-cron-secret-00';
const MONTHS = monthsBack('2026-10', 13);
const JONAS = 90_000_002;

/** Paulius's club tournament, community, past the newest dump month. */
const VILNIUS: FakeTour = {
  id: 'VilOpn26',
  name: 'Vilnius Open 2026',
  dates: ['2026-10-14', '2026-11-08'],
  rounds: ['RoundVO1', 'RoundVO2'],
};

const VILNIUS_PGN = tourPgn(VILNIUS, [
  // The community copy of the 2026-10 dump's game (rutaMonth).
  {
    roundId: 'RoundVO1',
    gameId: 'GameVO01',
    white: 'Pavyzdyte, Ruta',
    black: 'Testas, Jonas',
    whiteFideId: RUTA_FIDE_ID,
    blackFideId: JONAS,
    date: '2026-10-14',
    result: '1-0',
  },
  {
    roundId: 'RoundVO2',
    gameId: 'GameVO02',
    white: 'Testas, Jonas',
    black: 'Pavyzdyte, Ruta',
    whiteFideId: JONAS,
    blackFideId: RUTA_FIDE_ID,
    date: '2026-11-08',
    result: '0-1',
  },
]);

const EMPTY_PAGE = [{ json: toursPageJson([], null) }];

/** Lichess: the month list and dumps, and the broadcast API. */
function lichess(): Fetch {
  const months = fakeLichess({
    months: MONTHS,
    player: () => new Response('', { status: 404 }),
    dumps: Object.fromEntries(
      MONTHS.map((m) => [
        m,
        () => dumpResponse(compressedDump(rutaMonth(m))).response,
      ]),
    ),
  });
  const api = fakeLichessApi({
    'by/vakarinis?page=1': EMPTY_PAGE,
    'by/kesnor7?page=1': EMPTY_PAGE,
    'by/paulauskas?page=1': [{ json: toursPageJson([VILNIUS], null) }],
    [VILNIUS.id]: [{ json: tourDetailJson(VILNIUS) }],
    [pgnPath(VILNIUS.id)]: [{ text: VILNIUS_PGN }],
  });
  return (url, init) =>
    url.startsWith('https://lichess.org/api/broadcast/')
      ? api.fetch(url, init)
      : months(url, init);
}

/**
 * The services of one server process with a Lichess token, as the app
 * composes them: the real gateway, its pace included, over the fake
 * Lichess.
 */
function serverProcess(): ComposedFideServices & {
  community: NonNullable<ComposedFideServices['community']>;
} {
  const composed = composeFideServices({
    store: fideStoreOn(testDb()),
    fetch: lichess(),
    token: FAKE_LICHESS_TOKEN,
    secret: 'a-feature-test-secret-of-32-characters!!',
  });
  fide.composed = composed;
  const { community } = composed;
  if (community === null) throw new Error('no community broadcasts');
  return { ...composed, community };
}

async function searchRuta(): Promise<StartedSearch> {
  const state = await startFideSearchAction(
    { kind: 'idle' },
    formOf({ fideId: String(RUTA_FIDE_ID) }),
  );
  if (state.kind !== 'started') throw new Error(JSON.stringify(state));
  return state.search;
}

beforeEach(async () => {
  fide.fetched = [];
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  actAs(await person(sql, 'ruta@example.lt', 'Rūta'));
});

afterEach(async () => {
  await fideSettled();
  vi.unstubAllEnvs();
});

describe('community broadcasts (#349)', () => {
  it('lists the approved organisers at night and shows their tournament beside the months, without the copy of an official game', async () => {
    const { runner, community } = serverProcess();

    const night = await GET(
      new Request('http://localhost/api/cron/index-broadcasts', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(await night.json()).toMatchObject({
      queued: 12,
      ready: 0,
      community: 'started',
    });
    await community.settled();
    await runner.settled();

    expect(
      await sql.rows(
        'select tour_id, organiser, official, state from broadcast_tours',
      ),
    ).toEqual([
      {
        tour_id: 'VilOpn26',
        organiser: 'paulauskas',
        official: false,
        state: 'done',
      },
    ]);

    const { snapshot } = await searchRuta();
    expect(snapshot.progress.ready).toBe(12);
    expect(snapshot.games).toHaveLength(25);
    expect(snapshot.games[0]).toMatchObject({
      url: 'https://lichess.org/broadcast/synthetic/round-1/RoundVO2/GameVO02',
      source: { kind: 'tour', tourId: 'VilOpn26' },
      official: false,
      date: '2026-11-08',
      colour: 'black',
      outcome: 'win',
      event: 'Vilnius Open 2026',
    });
    // The community copy gives way to the dump's official game.
    expect(snapshot.games.filter((game) => game.date === '2026-10-14')).toEqual(
      [
        expect.objectContaining({
          url: 'https://lichess.org/broadcast/synthetic/round-1/w202610',
          official: true,
        }),
      ],
    );
  });
});
