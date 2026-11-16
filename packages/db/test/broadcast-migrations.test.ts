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

describe('migration 0018 keeps only organiser tournaments (#360, R-201)', () => {
  const migration = (): string =>
    readFileSync(
      join(MIGRATIONS_FOLDER, '0018_broadcast_tours_organiser_only.sql'),
      'utf8',
    );

  /**
   * Runs `body` on one connection inside a transaction rolled back after
   * it, with broadcast_tours as it was before 0018: an origin column and
   * an organiser that pasted tournaments left null.
   */
  async function beforeMigration(
    body: (query: (text: string) => Promise<unknown>) => Promise<void>,
  ): Promise<void> {
    const connection = await client.connect();
    const query = (text: string) => connection.query(text);
    try {
      await query('begin');
      await query(`alter table broadcast_tours
        drop constraint broadcast_tours_organiser_check,
        alter column organiser drop not null,
        add column origin text not null default 'organiser',
        add constraint broadcast_tours_origin_check
          check (origin in ('organiser', 'pasted')),
        add constraint broadcast_tours_organiser_check
          check ((origin = 'organiser') = (organiser is not null))`);
      await query(`insert into broadcast_tours (tour_id, name, organiser,
          official, last_round_at, state, attempts)
        values ('Org00001', 'Synthetic Open', 'paulauskas', false,
          '2026-10-20T10:00:00Z', 'pending', 0)`);
      await body(query);
    } finally {
      await query('rollback');
      connection.release();
    }
  }

  it('drops the origin and keeps every organiser tournament', async () => {
    await beforeMigration(async (query) => {
      await query(migration());
      const columns = await query(
        `select column_name from information_schema.columns
         where table_name = 'broadcast_tours' and column_name = 'origin'`,
      );
      const tours = await query(
        'select tour_id, organiser from broadcast_tours',
      );
      expect(columns).toEqual(expect.objectContaining({ rows: [] }));
      expect(tours).toEqual(
        expect.objectContaining({
          rows: [{ tour_id: 'Org00001', organiser: 'paulauskas' }],
        }),
      );
    });
  });

  it('stops with an error before any change when a pasted tournament exists', async () => {
    await beforeMigration(async (query) => {
      await query(`insert into broadcast_tours (tour_id, name, origin,
          organiser, official, last_round_at, state, attempts)
        values ('Pst00001', 'Synthetic Open', 'pasted', null, false,
          '2026-10-20T10:00:00Z', 'pending', 0)`);
      await expect(query(migration())).rejects.toThrow(
        /holds a pasted tournament/,
      );
    });
  });
});
