import type { BroadcastWindow } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { claimBroadcastMonth, pruneBroadcastIndex } from '../src';
import { useTestDatabase } from '../src/testing';
import { writeMonth, writeTour } from './support/broadcast-writes';
import { NOW, game, month, tourGame } from './support/broadcasts';

const { db, client } = useTestDatabase();

/** The 12 months 2025-01 to 2025-12; the window starts 2025-01-01T00:00Z. */
const WINDOW: BroadcastWindow = {
  oldest: month('2025-01'),
  newest: month('2025-12'),
};

async function storedMonths(): Promise<string[]> {
  const { rows } = await client.query<{ month: string }>(
    'select month from broadcast_months order by month',
  );
  return rows.map((row) => row.month);
}

async function storedTours(): Promise<string[]> {
  const { rows } = await client.query<{ tour_id: string }>(
    'select tour_id from broadcast_tours order by tour_id',
  );
  return rows.map((row) => row.tour_id);
}

async function storedGames(): Promise<{ url: string; source: string }[]> {
  const { rows } = await client.query<{ url: string; source: string }>(
    `select game_url as url, coalesce(month, tour_id) as source
     from broadcast_games order by game_url`,
  );
  return rows;
}

describe('pruneBroadcastIndex (#344)', () => {
  it('deletes the months before the window with their games, and keeps the oldest month in it', async () => {
    await writeMonth(db, '2024-11', [game(1)]);
    await writeMonth(db, '2024-12', [game(2)]);
    await writeMonth(db, '2025-01', [game(3)]);
    await writeMonth(db, '2025-12', [game(4)]);
    expect(await pruneBroadcastIndex(db, WINDOW)).toEqual({
      months: 2,
      tours: 0,
    });
    expect(await storedMonths()).toEqual(['2025-01', '2025-12']);
    expect(await storedGames()).toEqual([
      { url: game(3).url, source: '2025-01' },
      { url: game(4).url, source: '2025-12' },
    ]);
  });

  it('deletes a month before the window whatever its state', async () => {
    await claimBroadcastMonth(db, month('2024-10'), NOW);
    await client.query(
      `insert into broadcast_months (month, state, attempts) values ('2024-09', 'pending', 0)`,
    );
    expect((await pruneBroadcastIndex(db, WINDOW)).months).toBe(2);
    expect(await storedMonths()).toEqual([]);
  });

  it('keeps a game a newer month in the window also listed, under that month', async () => {
    await writeMonth(db, '2025-02', [game(1)]);
    await writeMonth(db, '2024-12', [game(1)]);
    await pruneBroadcastIndex(db, WINDOW);
    expect(await storedGames()).toEqual([
      { url: game(1).url, source: '2025-02' },
    ]);
  });

  it('deletes the tournaments whose last round is before the window, with their games', async () => {
    await writeTour(db, 'Old00001', [tourGame(1)], {
      lastRoundAt: new Date('2024-12-31T23:59:59Z'),
    });
    await writeTour(db, 'Edge0001', [tourGame(2)], {
      lastRoundAt: new Date('2025-01-01T00:00:00Z'),
    });
    expect(await pruneBroadcastIndex(db, WINDOW)).toEqual({
      months: 0,
      tours: 1,
    });
    expect(await storedTours()).toEqual(['Edge0001']);
    expect(await storedGames()).toEqual([
      { url: tourGame(2).url, source: 'Edge0001' },
    ]);
  });

  it('prunes nothing from an index inside the window, twice over', async () => {
    await writeMonth(db, '2025-01', [game(1)]);
    expect(await pruneBroadcastIndex(db, WINDOW)).toEqual({
      months: 0,
      tours: 0,
    });
    expect(await pruneBroadcastIndex(db, WINDOW)).toEqual({
      months: 0,
      tours: 0,
    });
    expect(await storedMonths()).toEqual(['2025-01']);
  });
});
