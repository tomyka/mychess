import { type BroadcastGameInput, type BroadcastWindow } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  FOUND_GAMES_LIMIT,
  claimBroadcastMonth,
  claimBroadcastTour,
  gamesForFideId,
  queueBroadcastTour,
  writeBroadcastMonth,
  writeBroadcastTour,
  type BroadcastSearchScope,
} from '../src';
import { useTestDatabase } from '../src/testing';
import {
  NOW,
  TOUR_ROUND,
  fideId,
  game,
  gamesNumbered,
  month,
  months,
  queuedTour,
  tourGame,
  tourId,
} from './support/broadcasts';

const { db } = useTestDatabase();

/** Dumps up to 2026-09, so the window starts in 2025-10. */
const WINDOW: BroadcastWindow = {
  oldest: month('2025-10'),
  newest: month('2026-09'),
};

const monthsOnly = (...texts: string[]): BroadcastSearchScope => ({
  months: months(...texts),
  window: null,
});

/** Claims `text`'s month at NOW and writes `games` into it. */
async function written(
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

/** Queues the tournament `id`, claims it and writes `games` into it. */
async function tourWritten(
  id: string,
  games: readonly BroadcastGameInput[],
  tour: Parameters<typeof queuedTour>[1] = {},
): Promise<void> {
  await queueBroadcastTour(db, queuedTour(id, tour));
  const claim = await claimBroadcastTour(db, tourId(id), NOW);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  const result = await writeBroadcastTour(db, {
    claim: claim.value,
    roundIds: [TOUR_ROUND],
    games,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(`write refused: ${result.refusal.reason}`);
}

describe('gamesForFideId over months (#316, R-185)', () => {
  it("gives the player's games across months, newest first, from the player's side", async () => {
    await written('2025-01', [
      game(1, { date: '2025-01-05', result: '0-1' }),
      game(2, { date: '2025-01-20', whiteFideId: 300, blackFideId: 100 }),
      game(3, { whiteFideId: 300, blackFideId: 400 }),
    ]);
    await written('2025-02', [
      game(4, { date: '2025-02-01', blackFideId: null, result: '*' }),
    ]);
    const found = await gamesForFideId(
      db,
      fideId(100),
      monthsOnly('2025-01', '2025-02'),
    );
    expect(found).toEqual({
      truncated: false,
      games: [
        {
          url: game(4).url,
          source: { kind: 'month', month: '2025-02' },
          official: true,
          date: '2025-02-01',
          event: 'Synthetic Open',
          eco: 'B90',
          opening: 'Sicilian Defense: Najdorf Variation',
          colour: 'white',
          opponent: { name: 'Black 4', fideId: null },
          outcome: 'unknown',
        },
        expect.objectContaining({
          url: game(2).url,
          colour: 'black',
          opponent: { name: 'White 2', fideId: 300 },
          outcome: 'loss',
        }),
        expect.objectContaining({
          url: game(1).url,
          colour: 'white',
          opponent: { name: 'Black 1', fideId: 200 },
          outcome: 'loss',
        }),
      ],
    });
  });

  it('searches only the months asked', async () => {
    await written('2025-01', [game(1)]);
    await written('2025-02', [game(2)]);
    const found = await gamesForFideId(db, fideId(100), monthsOnly('2025-02'));
    expect(found.games.map((one) => one.url)).toEqual([game(2).url]);
  });

  it('puts a game without a date after the dated games of its month', async () => {
    await written('2025-01', [
      game(1, { date: null }),
      game(2, { date: '2025-01-03' }),
    ]);
    const found = await gamesForFideId(db, fideId(100), monthsOnly('2025-01'));
    expect(found.games.map((one) => [one.url, one.date])).toEqual([
      [game(2).url, '2025-01-03'],
      [game(1).url, null],
    ]);
  });

  it('gives at most 1000 games and says when there were more (security L1)', async () => {
    expect(FOUND_GAMES_LIMIT).toBe(1000);
    await written('2025-01', gamesNumbered(FOUND_GAMES_LIMIT + 1));
    const found = await gamesForFideId(db, fideId(100), monthsOnly('2025-01'));
    expect(found.games).toHaveLength(FOUND_GAMES_LIMIT);
    expect(found.truncated).toBe(true);
  });

  it('is not truncated at exactly the limit', async () => {
    await written('2025-01', gamesNumbered(FOUND_GAMES_LIMIT));
    const found = await gamesForFideId(db, fideId(100), monthsOnly('2025-01'));
    expect(found.games).toHaveLength(FOUND_GAMES_LIMIT);
    expect(found.truncated).toBe(false);
  });

  it('gives nothing for no months and no window', async () => {
    await written('2025-01', [game(1)]);
    expect(await gamesForFideId(db, fideId(100), monthsOnly())).toEqual({
      games: [],
      truncated: false,
    });
  });
});

describe('gamesForFideId over tournaments (#349, spec decision 5)', () => {
  const dated = (n: number, date: string) => tourGame(n, { date });

  it('lists tournament and month games of the same month by date, newest first (architect b)', async () => {
    await written('2026-09', [
      game(1, { date: '2026-09-25' }),
      game(2, { date: '2026-09-05' }),
      game(3, { date: null }),
    ]);
    await tourWritten('Ab3dEf7h', [dated(4, '2026-09-15')], {
      lastRoundAt: new Date('2026-09-16T10:00:00Z'),
    });
    await tourWritten('Cd4eFg8h', [dated(5, '2026-10-02')], {
      lastRoundAt: new Date('2026-10-02T10:00:00Z'),
    });
    const found = await gamesForFideId(db, fideId(100), {
      months: months('2026-09'),
      window: WINDOW,
    });
    expect(found.games.map(({ url, date }) => [url, date])).toEqual([
      [dated(5, '').url, '2026-10-02'],
      [game(1).url, '2026-09-25'],
      [dated(4, '').url, '2026-09-15'],
      [game(2).url, '2026-09-05'],
      [game(3).url, null],
    ]);
  });

  it('gives tournament games beside month games, each with its source and whether it is official', async () => {
    await written('2026-09', [game(1, { date: '2026-09-10' })]);
    await tourWritten('Ab3dEf7h', [dated(2, '2026-10-18')]);
    await tourWritten('Cd4eFg8h', [dated(3, '2026-10-25')], {
      official: true,
      lastRoundAt: new Date('2026-10-26T10:00:00Z'),
    });
    const found = await gamesForFideId(db, fideId(100), {
      months: months('2026-09'),
      window: WINDOW,
    });
    expect(
      found.games.map(({ url, source, official }) => ({
        url,
        source,
        official,
      })),
    ).toEqual([
      {
        url: dated(3, '').url,
        source: { kind: 'tour', tourId: 'Cd4eFg8h' },
        official: true,
      },
      {
        url: dated(2, '').url,
        source: { kind: 'tour', tourId: 'Ab3dEf7h' },
        official: false,
      },
      {
        url: game(1).url,
        source: { kind: 'month', month: '2026-09' },
        official: true,
      },
    ]);
  });

  it('gives tournament games when no month is ready yet', async () => {
    await tourWritten('Ab3dEf7h', [dated(2, '2026-10-18')]);
    const found = await gamesForFideId(db, fideId(100), {
      months: [],
      window: WINDOW,
    });
    expect(found.games.map((one) => one.url)).toEqual([dated(2, '').url]);
  });

  it('leaves out tournaments whose last round is before the window', async () => {
    await tourWritten('Ab3dEf7h', [dated(2, '2025-09-30')], {
      lastRoundAt: new Date('2025-09-30T23:59:59Z'),
    });
    await tourWritten('Cd4eFg8h', [dated(3, '2025-10-01')], {
      lastRoundAt: new Date('2025-10-01T00:00:00Z'),
    });
    const found = await gamesForFideId(db, fideId(100), {
      months: [],
      window: WINDOW,
    });
    expect(found.games.map((one) => one.url)).toEqual([dated(3, '').url]);
  });

  it('leaves out every tournament when the search has no window', async () => {
    await tourWritten('Ab3dEf7h', [dated(2, '2026-10-18')]);
    expect(
      (await gamesForFideId(db, fideId(100), monthsOnly('2026-09'))).games,
    ).toEqual([]);
  });

  it('keeps a game a month listed first under the month, not the tournament', async () => {
    await written('2026-09', [dated(2, '2026-09-18')]);
    await tourWritten('Ab3dEf7h', [dated(2, '2026-09-18')]);
    const found = await gamesForFideId(db, fideId(100), {
      months: months('2026-09'),
      window: WINDOW,
    });
    expect(found.games.map(({ source }) => source)).toEqual([
      { kind: 'month', month: '2026-09' },
    ]);
  });
});
