import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimBroadcastMonth,
  queueBroadcastTour,
  writeBroadcastMonth,
} from '../src';
import { MIGRATIONS_FOLDER } from '../src/migrations';
import { useTestDatabase } from '../src/testing';
import { NOW, game, month, queuedTour } from './support/broadcasts';

const { db, client } = useTestDatabase();

const MINUTE = 60_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

interface StoredMonth {
  readonly month: string;
  readonly state: string;
  readonly attempts: number;
  readonly game_count: number | null;
  readonly claimed_at: Date | null;
  readonly failed_at: Date | null;
  readonly processed_at: Date | null;
}

async function store(
  row: Pick<StoredMonth, 'month' | 'state' | 'attempts'> & Partial<StoredMonth>,
): Promise<void> {
  await client.query(
    `insert into broadcast_months
       (month, state, attempts, game_count, claimed_at, failed_at, processed_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.month,
      row.state,
      row.attempts,
      row.game_count ?? null,
      row.claimed_at ?? null,
      row.failed_at ?? null,
      row.processed_at ?? null,
    ],
  );
}

async function storedMonths(): Promise<StoredMonth[]> {
  const { rows } = await client.query<StoredMonth>(
    `select month, state, attempts, game_count, claimed_at, failed_at, processed_at
     from broadcast_months order by month`,
  );
  return rows;
}

async function storedGames(): Promise<string[]> {
  const { rows } = await client.query<{ game_url: string }>(
    'select game_url from broadcast_games order by game_url',
  );
  return rows.map((row) => row.game_url);
}

async function tourStates(): Promise<string[]> {
  const { rows } = await client.query<{ state: string }>(
    'select state from broadcast_tours',
  );
  return rows.map((row) => row.state);
}

describe('migration 0017 resets the months stored done without games (#357)', () => {
  it('makes a done month with no games pending with no attempts, leaving every other row, twice over', async () => {
    const migration = readFileSync(
      join(MIGRATIONS_FOLDER, '0017_reset_empty_broadcast_months.sql'),
      'utf8',
    );
    await store({
      month: '2025-01',
      state: 'done',
      attempts: 1,
      game_count: 0,
      claimed_at: ago(3 * MINUTE),
      failed_at: ago(60 * MINUTE),
      processed_at: ago(MINUTE),
    });
    const claim = await claimBroadcastMonth(db, month('2025-02'), ago(MINUTE));
    if (!claim.ok) throw new Error(claim.refusal.reason);
    await writeBroadcastMonth(db, {
      claim: claim.value,
      games: [game(1)],
      clock: () => NOW,
    });
    await store({
      month: '2025-03',
      state: 'failed',
      attempts: 3,
      claimed_at: ago(3 * MINUTE),
      failed_at: ago(2 * MINUTE),
    });
    await store({
      month: '2025-04',
      state: 'pending',
      attempts: 1,
      failed_at: ago(2 * MINUTE),
    });
    await store({
      month: '2025-05',
      state: 'processing',
      attempts: 2,
      claimed_at: ago(5 * MINUTE),
    });
    await queueBroadcastTour(db, queuedTour('Ab3dEf7h'));
    const [, withGames, failed, pending, processing] = await storedMonths();

    await client.query(migration);
    await client.query(migration);

    expect(await storedMonths()).toEqual([
      {
        month: '2025-01',
        state: 'pending',
        attempts: 0,
        game_count: null,
        claimed_at: null,
        failed_at: null,
        processed_at: null,
      },
      withGames,
      failed,
      pending,
      processing,
    ]);
    expect(withGames).toEqual(
      expect.objectContaining({ state: 'done', game_count: 1 }),
    );
    expect(await storedGames()).toEqual([game(1).url]);
    expect(await tourStates()).toEqual(['pending']);
    expect((await claimBroadcastMonth(db, month('2025-01'), NOW)).ok).toBe(
      true,
    );
  });
});
