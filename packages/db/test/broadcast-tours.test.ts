import type { BroadcastGameInput, BroadcastWindow } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  broadcastTourStatuses,
  claimBroadcastMonth,
  claimBroadcastTour,
  failBroadcastTour,
  queueBroadcastTour,
  releaseInterruptedBroadcastTours,
  writeBroadcastMonth,
  writeBroadcastTour,
  type BroadcastTourClaim,
} from '../src';
import { useTestDatabase } from '../src/testing';
import {
  NOW,
  TOUR_ROUND,
  game,
  month,
  queuedTour,
  tourGame,
  tourId,
} from './support/broadcasts';

const { db, client } = useTestDatabase();

/** Claims `text`'s month at NOW and writes `games` into it. */
async function writtenMonth(
  text: string,
  games: readonly BroadcastGameInput[],
): Promise<void> {
  const claim = await claimBroadcastMonth(db, month(text), NOW);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  const result = await writeBroadcastMonth(db, {
    claim: claim.value,
    games,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(`write refused: ${result.refusal.reason}`);
}

async function whiteOf(url: string): Promise<string | undefined> {
  const { rows } = await client.query<{ white: string }>(
    'select white from broadcast_games where game_url = $1',
    [url],
  );
  return rows[0]?.white;
}

const MINUTE = 60_000;
const later = (ms: number): Date => new Date(NOW.getTime() + ms);

const WINDOW: BroadcastWindow = {
  oldest: month('2025-10'),
  newest: month('2026-09'),
};

const ID = 'Ab3dEf7h';

async function claimed(id = ID, at = NOW): Promise<BroadcastTourClaim> {
  const claim = await claimBroadcastTour(db, tourId(id), at);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  return claim.value;
}

async function statusOf(id = ID) {
  const entries = await broadcastTourStatuses(db, WINDOW);
  return entries.find((entry) => entry.tourId === id)?.status;
}

async function tourRow(id = ID) {
  const { rows } = await client.query<{
    origin: string;
    organiser: string | null;
    game_count: number | null;
  }>(
    'select origin, organiser, game_count from broadcast_tours where tour_id = $1',
    [id],
  );
  return rows[0];
}

async function sourcesOfGames() {
  const { rows } = await client.query<{
    game_url: string;
    month: string | null;
    tour_id: string | null;
  }>('select game_url, month, tour_id from broadcast_games order by game_url');
  return rows;
}

describe('queueBroadcastTour (#349, spec decision 1)', () => {
  it("queues an organiser's tournament pending, keeping its organiser", async () => {
    expect(await queueBroadcastTour(db, queuedTour(ID))).toBe(true);
    expect(await tourRow()).toEqual({
      origin: 'organiser',
      organiser: 'paulauskas',
      game_count: null,
    });
    expect(await statusOf()).toEqual({
      state: 'pending',
      attempts: 0,
      lastFailedAt: null,
    });
  });

  it('queues a pasted tournament without anyone who pasted it', async () => {
    await queueBroadcastTour(
      db,
      queuedTour(ID, { origin: { kind: 'pasted' } }),
    );
    expect(await tourRow()).toEqual({
      origin: 'pasted',
      organiser: null,
      game_count: null,
    });
  });

  it('leaves a tournament already queued as it is, whatever its state', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    await claimed();
    expect(
      await queueBroadcastTour(
        db,
        queuedTour(ID, { origin: { kind: 'pasted' }, name: 'Other' }),
      ),
    ).toBe(false);
    expect((await tourRow())?.origin).toBe('organiser');
    expect((await statusOf())?.state).toBe('processing');
  });
});

describe('broadcastTourStatuses (#349)', () => {
  it('lists the tournaments whose last round is in the window, newest first', async () => {
    await queueBroadcastTour(
      db,
      queuedTour('Old00000', { lastRoundAt: new Date('2025-09-30T23:00:00Z') }),
    );
    await queueBroadcastTour(
      db,
      queuedTour('Edge0000', { lastRoundAt: new Date('2025-10-01T00:00:00Z') }),
    );
    await queueBroadcastTour(
      db,
      queuedTour('New00000', {
        official: true,
        lastRoundAt: new Date('2026-10-20T00:00:00Z'),
      }),
    );
    expect(await broadcastTourStatuses(db, WINDOW)).toEqual([
      {
        tourId: 'New00000',
        name: 'Synthetic Open',
        official: true,
        lastRoundAt: new Date('2026-10-20T00:00:00Z'),
        status: { state: 'pending', attempts: 0, lastFailedAt: null },
      },
      expect.objectContaining({ tourId: 'Edge0000', official: false }),
    ]);
  });
});

describe('claimBroadcastTour (#349, as a month)', () => {
  it('claims a queued tournament as its first attempt', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    expect(await claimBroadcastTour(db, tourId(ID), NOW)).toEqual({
      ok: true,
      value: { tourId: ID, claimedAt: NOW },
    });
    expect(await statusOf()).toEqual({
      state: 'processing',
      attempts: 1,
      since: NOW,
    });
  });

  it('refuses a tournament nobody queued', async () => {
    expect(await claimBroadcastTour(db, tourId(ID), NOW)).toEqual({
      ok: false,
      refusal: { reason: 'fide.tourNotClaimable' },
    });
  });

  it('lets exactly one of several concurrent claims through', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimBroadcastTour(db, tourId(ID), NOW)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it('refuses a tournament being processed until it goes stale and its pause ends (R-188)', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    await claimed();
    expect((await claimBroadcastTour(db, tourId(ID), later(MINUTE))).ok).toBe(
      false,
    );
    expect(
      (await claimBroadcastTour(db, tourId(ID), later(26 * MINUTE))).ok,
    ).toBe(true);
  });
});

describe('writeBroadcastTour (#349, spec decision 1)', () => {
  it("writes a tournament's games under it and marks it done", async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    const result = await writeBroadcastTour(db, {
      claim: await claimed(),
      roundIds: [TOUR_ROUND],
      games: [
        tourGame(1),
        tourGame(2, { whiteFideId: null, blackFideId: null }),
      ],
      clock: () => later(MINUTE),
    });
    expect(result).toEqual({ ok: true, value: { gameCount: 1, skipped: 1 } });
    expect(await statusOf()).toEqual({
      state: 'done',
      attempts: 1,
      since: later(MINUTE),
    });
    expect((await tourRow())?.game_count).toBe(1);
    expect(await sourcesOfGames()).toEqual([
      { game_url: tourGame(1).url, month: null, tour_id: ID },
    ]);
  });

  it("drops, and counts as skipped, every game not of the tournament's own rounds (security M1)", async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    const result = await writeBroadcastTour(db, {
      claim: await claimed(),
      roundIds: [TOUR_ROUND, tourId('Rnd00002')],
      games: [
        tourGame(1),
        tourGame(2, {}, 'Rnd00002'),
        tourGame(3, {}, 'Other001'),
        game(4),
        tourGame(5, { url: 'https://lichess.org/Gm5Gm5Gm' }),
      ],
      clock: () => NOW,
    });
    expect(result).toEqual({ ok: true, value: { gameCount: 2, skipped: 3 } });
    expect((await sourcesOfGames()).map((row) => row.game_url)).toEqual([
      tourGame(1).url,
      tourGame(2, {}, 'Rnd00002').url,
    ]);
  });

  it('keeps a game another tournament stored first under that one', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    await queueBroadcastTour(db, queuedTour('Cd4eFg8h'));
    for (const id of [ID, 'Cd4eFg8h']) {
      await writeBroadcastTour(db, {
        claim: await claimed(id),
        roundIds: [TOUR_ROUND],
        games: [tourGame(1, { white: `White of ${id}` })],
        clock: () => NOW,
      });
    }
    expect(await sourcesOfGames()).toEqual([
      { game_url: tourGame(1).url, month: null, tour_id: ID },
    ]);
  });

  it("never replaces a month's game", async () => {
    await writtenMonth('2026-10', [tourGame(1)]);
    await queueBroadcastTour(db, queuedTour(ID));
    await writeBroadcastTour(db, {
      claim: await claimed(),
      roundIds: [TOUR_ROUND],
      games: [tourGame(1, { white: 'Changed' })],
      clock: () => NOW,
    });
    expect(await sourcesOfGames()).toEqual([
      { game_url: tourGame(1).url, month: '2026-10', tour_id: null },
    ]);
    expect(await whiteOf(tourGame(1).url)).toBe('White 1');
  });

  it('refuses, writing nothing, once a later claim took the stale tournament over', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    const first = await claimed();
    await claimed(ID, later(26 * MINUTE));
    expect(
      await writeBroadcastTour(db, {
        claim: first,
        roundIds: [TOUR_ROUND],
        games: [tourGame(1)],
        clock: () => NOW,
      }),
    ).toEqual({ ok: false, refusal: { reason: 'fide.tourClaimLost' } });
    expect(await sourcesOfGames()).toEqual([]);
  });
});

describe('writeBroadcastMonth over a tournament game (#349, security M1)', () => {
  it("replaces a tournament's game with the dump's: official data wins", async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    await writeBroadcastTour(db, {
      claim: await claimed(),
      roundIds: [TOUR_ROUND],
      games: [tourGame(1, { white: 'Community name' }), tourGame(2)],
      clock: () => NOW,
    });
    await writtenMonth('2026-10', [tourGame(1, { white: 'Official name' })]);
    expect(await sourcesOfGames()).toEqual([
      { game_url: tourGame(1).url, month: '2026-10', tour_id: null },
      { game_url: tourGame(2).url, month: null, tour_id: ID },
    ]);
    expect(await whiteOf(tourGame(1).url)).toBe('Official name');
  });

  it("never replaces another month's game", async () => {
    await writtenMonth('2026-09', [tourGame(1)]);
    await writtenMonth('2026-10', [tourGame(1, { white: 'Changed' })]);
    expect(await sourcesOfGames()).toEqual([
      { game_url: tourGame(1).url, month: '2026-09', tour_id: null },
    ]);
    expect(await whiteOf(tourGame(1).url)).toBe('White 1');
  });
});

describe('failBroadcastTour (#349, R-188 as a month)', () => {
  it('leaves a tournament pending after a failed attempt, failed after the third', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    let at = NOW;
    for (const attempt of [1, 2, 3]) {
      const failed = await failBroadcastTour(db, await claimed(ID, at), at);
      expect(failed).toEqual({
        ok: true,
        value:
          attempt < 3
            ? { state: 'pending', attempts: attempt, lastFailedAt: at }
            : { state: 'failed', attempts: 3, since: at },
      });
      at = new Date(at.getTime() + 10 * MINUTE);
    }
  });

  it('refuses once the claim is no longer held', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    const first = await claimed();
    await claimed(ID, later(26 * MINUTE));
    expect(await failBroadcastTour(db, first, later(27 * MINUTE))).toEqual({
      ok: false,
      refusal: { reason: 'fide.tourClaimLost' },
    });
  });
});

describe('releaseInterruptedBroadcastTours (#355 as a month)', () => {
  it('makes a tournament a previous process left processing pending again, refunding its attempt', async () => {
    await queueBroadcastTour(db, queuedTour(ID));
    await queueBroadcastTour(db, queuedTour('Cd4eFg8h'));
    await claimed(ID, NOW);
    await claimed('Cd4eFg8h', later(MINUTE));
    expect(await releaseInterruptedBroadcastTours(db, later(MINUTE))).toBe(1);
    expect(await statusOf()).toEqual({
      state: 'pending',
      attempts: 0,
      lastFailedAt: null,
    });
    expect((await statusOf('Cd4eFg8h'))?.state).toBe('processing');
  });
});
