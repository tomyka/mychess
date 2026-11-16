import {
  broadcastMonthSchema,
  broadcastTourIdSchema,
  ok,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compressedDump,
  dumpResponse,
  dumpServer,
  RUTA_FIDE_ID,
  rutaMonth,
} from '../../test/fixtures/broadcast-dumps';
import { inMemoryLichessBroadcasts } from '../../test/fixtures/in-memory-lichess-broadcasts';
import type { FakeTour } from '../../test/fixtures/lichess-broadcast-api';
import { createBroadcastRunner, type BroadcastIndex } from './broadcast-runner';
import type { BroadcastTourIndex } from './broadcast-tour-job';

const NOW = new Date('2026-11-10T10:00:00Z');
const OCT = broadcastMonthSchema.parse('2026-10');

const TOUR: FakeTour = {
  id: 'VilOpn26',
  name: 'Vilnius Open 2026',
  dates: ['2026-10-01', '2026-10-05'],
  rounds: ['RoundAA1'],
};
const TOUR_ID = broadcastTourIdSchema.parse(TOUR.id);
const GAMES = [
  {
    roundId: 'RoundAA1',
    gameId: 'GameAAA1',
    white: 'Pavyzdyte, Ruta',
    black: 'Testas, Jonas',
    whiteFideId: RUTA_FIDE_ID,
    date: '2026-10-01',
    result: '1-0',
  },
];

/** What was written, a month's or a tournament's, and the most at once. */
const written: { key: string; games: unknown[] }[] = [];
let writing = 0;
let mostWriting = 0;

async function reading(
  key: string,
  games: AsyncIterable<unknown> | Iterable<unknown>,
) {
  writing += 1;
  mostWriting = Math.max(mostWriting, writing);
  try {
    const all: unknown[] = [];
    for await (const game of games) all.push(game);
    written.push({ key, games: all });
    return ok({ gameCount: all.length, skipped: 0 });
  } finally {
    writing -= 1;
  }
}

const months = {
  claim: vi.fn<BroadcastIndex['claim']>(),
  write: vi.fn<BroadcastIndex['write']>(),
  fail: vi.fn<BroadcastIndex['fail']>(),
  release: vi.fn<BroadcastIndex['release']>(),
};

const tours = {
  claim: vi.fn<BroadcastTourIndex['claim']>(),
  write: vi.fn<BroadcastTourIndex['write']>(),
  fail: vi.fn<BroadcastTourIndex['fail']>(),
  release: vi.fn<BroadcastTourIndex['release']>(),
};

const errors = vi.spyOn(console, 'error');

beforeEach(() => {
  written.length = 0;
  writing = 0;
  mostWriting = 0;
  errors.mockReset().mockImplementation(() => undefined);
  months.claim
    .mockReset()
    .mockImplementation((month) =>
      Promise.resolve(ok({ month, claimedAt: NOW })),
    );
  months.write
    .mockReset()
    .mockImplementation(({ claim, games }) => reading(claim.month, games));
  months.fail
    .mockReset()
    .mockResolvedValue(ok({ state: 'failed', attempts: 3, since: NOW }));
  months.release.mockReset().mockResolvedValue(0);
  tours.claim
    .mockReset()
    .mockImplementation((tourId) =>
      Promise.resolve(ok({ tourId, claimedAt: NOW })),
    );
  tours.write
    .mockReset()
    .mockImplementation(({ claim, games }) => reading(claim.tourId, games));
  tours.fail
    .mockReset()
    .mockResolvedValue(ok({ state: 'failed', attempts: 3, since: NOW }));
  tours.release.mockReset().mockResolvedValue(0);
});

function runner(withToken = true) {
  const lichess = inMemoryLichessBroadcasts({
    tours: [{ tour: TOUR, games: GAMES }],
  });
  const run = createBroadcastRunner({
    index: months,
    fetch: dumpServer({
      [OCT]: () => dumpResponse(compressedDump(rutaMonth(OCT))).response,
    }).fetch,
    clock: () => NOW,
    tours: withToken ? { index: tours, broadcasts: lichess } : null,
  });
  return { run, lichess };
}

describe('the broadcast runner with tournaments (#349)', () => {
  it('fetches a needed tournament into the index', async () => {
    const { run } = runner();
    run.needTours([TOUR_ID]);
    await run.settled();
    expect(tours.claim).toHaveBeenCalledExactlyOnceWith(TOUR_ID, NOW);
    expect(written).toEqual([
      {
        key: TOUR_ID,
        games: [expect.objectContaining({ whiteFideId: RUTA_FIDE_ID })],
      },
    ]);
  });

  it('processes months and tournaments one download at a time, each once, in the order needed', async () => {
    const { run, lichess } = runner();
    run.need([OCT]);
    run.needTours([TOUR_ID, TOUR_ID]);
    run.need([OCT]);
    await run.settled();
    expect(written.map((w) => w.key)).toEqual([OCT, TOUR_ID]);
    expect(mostWriting).toBe(1);
    expect(lichess.calls).toHaveLength(2);
  });

  it('releases the months and the tournaments a previous process left processing, once', async () => {
    const { run } = runner();
    run.needTours([TOUR_ID]);
    await run.settled();
    run.need([OCT]);
    await run.settled();
    expect(months.release).toHaveBeenCalledExactlyOnceWith(NOW);
    expect(tours.release).toHaveBeenCalledExactlyOnceWith(NOW);
  });

  it('logs a failed tournament release by its error name and still claims', async () => {
    tours.release.mockRejectedValue(new TypeError('a text naming anything'));
    const { run } = runner();
    run.needTours([TOUR_ID]);
    await run.settled();
    expect(errors.mock.calls[0]).toEqual([
      'fide: broadcast index release failed',
      'TypeError',
    ]);
    expect(written.map((w) => w.key)).toEqual([TOUR_ID]);
  });

  it('ignores the tournaments needed without a Lichess token, and releases none', async () => {
    const { run, lichess } = runner(false);
    run.needTours([TOUR_ID]);
    await run.settled();
    run.need([OCT]);
    await run.settled();
    expect(lichess.calls).toEqual([]);
    expect(tours.claim).not.toHaveBeenCalled();
    expect(tours.release).not.toHaveBeenCalled();
    expect(written.map((w) => w.key)).toEqual([OCT]);
  });

  it('logs a failed tournament by its id and error name, and goes on', async () => {
    tours.write.mockRejectedValue(
      new TypeError('a text that may name anything'),
    );
    const { run } = runner();
    run.needTours([TOUR_ID]);
    run.need([OCT]);
    await run.settled();
    expect(errors.mock.calls[0]).toEqual([
      'fide: broadcast tour VilOpn26 failed',
      'TypeError',
    ]);
    expect(written.map((w) => w.key)).toEqual([OCT]);
  });
});
