import type { BroadcastTourClaim, BroadcastTourWrite } from '@mychess/db';
import {
  broadcastTourIdSchema,
  ok,
  refuse,
  type BroadcastTourId,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inMemoryLichessBroadcasts,
  type Scripted,
} from '../../test/fixtures/in-memory-lichess-broadcasts';
import type { FakeTour } from '../../test/fixtures/lichess-broadcast-api';
import { processTour, type BroadcastTourIndex } from './broadcast-tour-job';

const NOW = new Date('2026-11-10T10:00:00Z');
const TOUR_ID = broadcastTourIdSchema.parse('VilOpn26');

const TOUR: FakeTour = {
  id: TOUR_ID,
  name: 'Vilnius Open 2026',
  dates: ['2026-10-01', '2026-10-05'],
  rounds: ['RoundAA1', 'RoundAA2'],
};

const GAMES = [
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
];

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
  {
    tour = TOUR,
    script = {},
  }: {
    tour?: FakeTour;
    script?: Readonly<Record<string, readonly Scripted[]>>;
  } = {},
  limits = LIMITS,
) {
  const broadcasts = inMemoryLichessBroadcasts({
    tours: [{ tour, games: GAMES }],
    script,
  });
  await processTour({ index, broadcasts, clock: () => NOW, limits }, TOUR_ID);
  return broadcasts;
}

describe('a broadcast tournament job (#349)', () => {
  it('checks the tour is finished, claims it and writes its PGN games with its round ids', async () => {
    const broadcasts = await run();
    expect(broadcasts.calls).toEqual(['tour VilOpn26', 'pgn VilOpn26']);
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
    const broadcasts = await run({ tour: { ...TOUR, running: ['RoundAA2'] } });
    expect(broadcasts.calls).toEqual(['tour VilOpn26']);
    expect(index.claim).not.toHaveBeenCalled();
    expect(index.fail).not.toHaveBeenCalled();
  });

  it.each([
    'lichessBroadcast.notFound',
    'lichessBroadcast.rateLimited',
    'lichessBroadcast.unavailable',
    'lichessBroadcast.unauthorized',
  ] as const)(
    'neither claims nor fails a tour whose detail is refused with %s, and logs the refusal',
    async (reason) => {
      await run({ script: { 'tour VilOpn26': [reason] } });
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
    const broadcasts = await run();
    expect(broadcasts.calls).toEqual(['tour VilOpn26']);
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).not.toHaveBeenCalled();
  });

  it('marks the attempt failed when the PGN is refused, and logs the refusal', async () => {
    await run({ script: { 'pgn VilOpn26': ['lichessBroadcast.rateLimited'] } });
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'fide: broadcast tour VilOpn26 failed',
      'lichessBroadcast.rateLimited',
    );
  });

  it('marks the attempt failed and throws when the write fails', async () => {
    index.write.mockRejectedValue(new Error('insert failed'));
    await expect(run()).rejects.toThrow('insert failed');
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
  });

  it('marks nothing failed when the write says the claim was lost', async () => {
    index.write.mockResolvedValue(refuse('fide.tourClaimLost'));
    await run();
    expect(index.fail).not.toHaveBeenCalled();
  });

  it('gives up on a PGN that does not answer within the idle limit the gateway armed', async () => {
    await expect(
      run(
        { script: { 'pgn VilOpn26': ['hang'] } },
        { deadlineMs: 60_000, idleMs: 50 },
      ),
    ).rejects.toThrow();
    expect(index.write).not.toHaveBeenCalled();
    expect(index.fail).toHaveBeenCalledExactlyOnceWith(claimOf(TOUR_ID), NOW);
  });
});
