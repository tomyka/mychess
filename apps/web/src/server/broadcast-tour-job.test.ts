import type { BroadcastTourClaim, BroadcastTourWrite } from '@mychess/db';
import {
  broadcastTourIdSchema,
  ok,
  refuse,
  type BroadcastTourId,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  pgnPath,
  tourDetailJson,
  tourPgn,
  type FakeAnswer,
  type FakeTour,
} from '../../test/fixtures/lichess-broadcast-api';
import { processTour, type BroadcastTourIndex } from './broadcast-tour-job';
import {
  createLichessPacer,
  LICHESS_PACE,
  NO_ABORT,
  sleep,
} from './lichess-pace';

const NOW = new Date('2026-11-10T10:00:00Z');
const TOUR_ID = broadcastTourIdSchema.parse('VilOpn26');

const TOUR: FakeTour = {
  id: TOUR_ID,
  name: 'Vilnius Open 2026',
  dates: ['2026-10-01', '2026-10-05'],
  rounds: ['RoundAA1', 'RoundAA2'],
};

const PGN = tourPgn(TOUR, [
  {
    roundId: 'RoundAA1',
    gameId: 'GameAAA1',
    white: 'Pavyzdyte, Ruta',
    black: 'Testas, Jonas',
    whiteFideId: 90_000_001,
    blackFideId: 90_000_002,
    date: '2026-10-01',
    result: '1-0',
  },
]);

const index = {
  claim: vi.fn<BroadcastTourIndex['claim']>(),
  write: vi.fn<BroadcastTourIndex['write']>(),
  fail: vi.fn<BroadcastTourIndex['fail']>(),
  release: vi.fn<BroadcastTourIndex['release']>(),
};

const claimOf = (tourId: BroadcastTourId): BroadcastTourClaim => ({
  tourId,
  claimedAt: NOW,
});

/** What each write was given: its round ids and every game it read. */
const written: { roundIds: readonly string[]; games: unknown[] }[] = [];
async function readingWrite({
  roundIds,
  games,
}: BroadcastTourWrite): ReturnType<BroadcastTourIndex['write']> {
  const all: unknown[] = [];
  for await (const game of games) all.push(game);
  written.push({ roundIds, games: all });
  return ok({ gameCount: all.length, skipped: 0 });
}

const errors = vi.spyOn(console, 'error');

beforeEach(() => {
  written.length = 0;
  errors.mockReset().mockImplementation(() => undefined);
  index.claim
    .mockReset()
    .mockImplementation((tourId) => Promise.resolve(ok(claimOf(tourId))));
  index.write.mockReset().mockImplementation(readingWrite);
  index.fail
    .mockReset()
    .mockResolvedValue(
      ok({ state: 'pending', attempts: 1, lastFailedAt: NOW }),
    );
  index.release.mockReset().mockResolvedValue(0);
});

const LIMITS = { deadlineMs: 60_000, idleMs: 60_000 };

async function run(
  answers: Readonly<Record<string, readonly FakeAnswer[]>>,
  limits = LIMITS,
) {
  const lichess = fakeLichessApi(answers);
  // Which lane each request went through, as the pacer would see it.
  const lanes: string[] = [];
  const lane =
    (name: string): typeof lichess.fetch =>
    (url, init) => {
      lanes.push(name);
      signals.push(init.signal ?? null);
      return lichess.fetch(url, init);
    };
  await processTour(
    {
      index,
      api: { fetch: lane('night'), token: FAKE_LICHESS_TOKEN },
      downloadApi: (onTurn) => ({
        fetch: (url, init) => {
          onTurn();
          return lane('download')(url, init);
        },
        token: FAKE_LICHESS_TOKEN,
      }),
      clock: () => NOW,
      limits,
    },
    TOUR_ID,
  );
  return { ...lichess, lanes };
}

const signals: (AbortSignal | null)[] = [];

const FINISHED = {
  [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
  [pgnPath(TOUR_ID)]: [{ text: PGN }],
};

describe('a broadcast tournament job (#349)', () => {
  it('checks the tour is finished, claims it and writes its PGN games with its round ids', async () => {
    const lichess = await run(FINISHED);
    expect(lichess.requested).toEqual([
      'https://lichess.org/api/broadcast/VilOpn26',
      'https://lichess.org/api/broadcast/VilOpn26.pgn?clocks=false&comments=false',
    ]);
    expect(index.claim).toHaveBeenCalledExactlyOnceWith(TOUR_ID, NOW);
    expect(written).toEqual([
      {
        roundIds: ['RoundAA1', 'RoundAA2'],
        games: [
          expect.objectContaining({
            whiteFideId: 90_000_001,
            url: 'https://lichess.org/broadcast/synthetic/round-1/RoundAA1/GameAAA1',
          }),
        ],
      },
    ]);
    expect(index.write.mock.lastCall?.[0].claim).toEqual(claimOf(TOUR_ID));
    expect(index.write.mock.lastCall?.[0].clock()).toEqual(NOW);
    expect(index.fail).not.toHaveBeenCalled();
  });

  it('neither claims nor downloads a tour not finished: it stays queued for a later night', async () => {
    const running = { ...TOUR, running: ['RoundAA2'] };
    const lichess = await run({
      [TOUR_ID]: [{ json: tourDetailJson(running) }],
      [pgnPath(TOUR_ID)]: [{ text: PGN }],
    });
    expect(lichess.requested).toHaveLength(1);
    expect(index.claim).not.toHaveBeenCalled();
    expect(index.fail).not.toHaveBeenCalled();
  });

  it.each([
    ['not found', { status: 404 }, 'lichessBroadcast.notFound'],
    ['rate limited', { status: 429 }, 'lichessBroadcast.rateLimited'],
    ['unavailable', { status: 503 }, 'lichessBroadcast.unavailable'],
    ['refused for the token', { status: 401 }, 'lichessBroadcast.unauthorized'],
  ])(
    'neither claims nor fails a tour whose detail is %s, and logs the refusal',
    async (_, answer, reason) => {
      await run({ [TOUR_ID]: [answer] });
      expect(index.claim).not.toHaveBeenCalled();
      expect(index.fail).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        'fide: broadcast tour VilOpn26 skipped',
        reason,
      );
    },
  );

  it('downloads nothing for a tour whose claim is refused: someone else has it, or it is done', async () => {
    index.claim.mockResolvedValue(refuse('fide.tourNotClaimable'));
    const lichess = await run(FINISHED);
    expect(lichess.requested).toHaveLength(1);
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).not.toHaveBeenCalled();
  });

  it('marks the attempt failed when the PGN is refused, and logs the refusal', async () => {
    await run({ ...FINISHED, [pgnPath(TOUR_ID)]: [{ status: 429 }] });
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'fide: broadcast tour VilOpn26 failed',
      'lichessBroadcast.rateLimited',
    );
  });

  it('marks the attempt failed and throws when the write fails', async () => {
    index.write.mockRejectedValue(new Error('insert failed'));
    await expect(run(FINISHED)).rejects.toThrow('insert failed');
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
  });

  it('marks nothing failed when the write says the claim was lost', async () => {
    index.write.mockResolvedValue(refuse('fide.tourClaimLost'));
    await run(FINISHED);
    expect(index.fail).not.toHaveBeenCalled();
  });

  it('gives up on a PGN that does not answer within the idle limit', async () => {
    await expect(
      run(
        { ...FINISHED, [pgnPath(TOUR_ID)]: ['hang'] },
        { deadlineMs: 60_000, idleMs: 50 },
      ),
    ).rejects.toThrow();
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
  });

  it('asks the detail in the night lane, which times it, and the PGN in the download lane (architect L3)', async () => {
    signals.length = 0;
    const lichess = await run(FINISHED);
    expect(lichess.lanes).toEqual(['night', 'download']);
    // The detail leaves its timeout to the lane (LICHESS_PACE.requestMs
    // from its turn); the PGN carries the runner's download limits.
    expect(signals[0]).toBe(NO_ABORT);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).not.toBe(NO_ABORT);
  });
});

describe('a broadcast tournament job behind the Lichess pacer', () => {
  it('arms the idle limit when the PGN is sent: a download queued behind a 60 s pause still completes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const lichess = fakeLichessApi({
        ...FINISHED,
        blocked: [{ status: 429 }],
      });
      let blocker: Promise<Response> | undefined;
      const sent: [string, number][] = [];
      const start = Date.now();
      // As the detail is asked, another night call joins the queue: it is
      // sent before the PGN, answers 429, and holds the PGN a minute.
      const fetch: typeof lichess.fetch = (url, init) => {
        sent.push([url.slice(url.lastIndexOf('/') + 1), Date.now() - start]);
        if (url.endsWith(`/${TOUR_ID}`)) {
          blocker = pacer.fetch('night')(
            'https://lichess.org/api/broadcast/blocked',
            { headers: { Authorization: `Bearer ${FAKE_LICHESS_TOKEN}` } },
          );
        }
        return lichess.fetch(url, init);
      };
      const pacer = createLichessPacer(fetch, {
        ...LICHESS_PACE,
        sleep,
        clock: () => Date.now(),
      });
      const done = processTour(
        {
          index,
          api: { fetch: pacer.fetch('night'), token: FAKE_LICHESS_TOKEN },
          downloadApi: (onTurn) => ({
            fetch: pacer.fetch('download', onTurn),
            token: FAKE_LICHESS_TOKEN,
          }),
          clock: () => NOW,
          // An idle limit far shorter than the pause.
          limits: { deadlineMs: 10 * 60_000, idleMs: 5000 },
        },
        TOUR_ID,
      );
      await vi.advanceTimersByTimeAsync(62_000);
      await done;
      expect((await blocker)?.status).toBe(429);
      expect(sent).toEqual([
        [TOUR_ID, 0],
        ['blocked', 1000],
        [`${TOUR_ID}.pgn?clocks=false&comments=false`, 61_000],
      ]);
      expect(written).toHaveLength(1);
      expect(index.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
