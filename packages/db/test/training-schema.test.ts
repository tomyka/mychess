import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../src/testing';

const { client } = useTestDatabase();

const insertAccount = (id: string) =>
  client.query(
    `insert into accounts (id, email, display_name, created_at, updated_at)
     values ($1, $2, '', now(), now())`,
    [id, `${id}@example.lt`],
  );

/** A review row; `entered` says which of learned_at and skipped_at is set. */
const insertReview = (
  playerId: string,
  moveKey: string,
  entered: { learned: boolean; skipped: boolean },
) =>
  client.query(
    `insert into reviews (player_id, move_key, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
       learned_at, skipped_at, created_at, updated_at)
     values ($1, $2, now(), 1, 5, 0, 1, 0, 1, 0, 2,
       case when $3 then now() end, case when $4 then now() end, now(), now())`,
    [playerId, moveKey, entered.learned, entered.skipped],
  );

const LEARNED = { learned: true, skipped: false };

const insertResult = (playerId: string) =>
  client.query(
    `insert into review_results (result_id, player_id, move_key, repertoire_id,
       kind, answered_at, applied, received_at)
     values (gen_random_uuid(), $1, 'k', gen_random_uuid(), 'pass', now(), true, now())`,
    [playerId],
  );

const count = async (table: 'reviews' | 'review_results'): Promise<number> => {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return rows[0]?.n ?? -1;
};

describe('the training tables', () => {
  beforeEach(async () => {
    await insertAccount('p');
  });

  it('keeps a review entered once, by a learn pass or by "I know this"', async () => {
    await insertReview('p', 'learned', LEARNED);
    await insertReview('p', 'skipped', { learned: false, skipped: true });
    expect(await count('reviews')).toBe(2);
  });

  it.each([
    ['both learned and skipped', { learned: true, skipped: true }],
    ['neither learned nor skipped', { learned: false, skipped: false }],
  ])('refuses a review %s', async (_, entered) => {
    await expect(insertReview('p', 'k', entered)).rejects.toThrow(
      /reviews_entered_once/,
    );
  });

  it('refuses a second review of the same move key for the same player', async () => {
    await insertAccount('q');
    await insertReview('p', 'k', LEARNED);
    await insertReview('q', 'k', LEARNED);
    await expect(insertReview('p', 'k', LEARNED)).rejects.toThrow(
      /reviews_pkey|duplicate key/,
    );
  });

  it('refuses a result kind that does not exist', async () => {
    await expect(
      client.query(
        `insert into review_results (result_id, player_id, move_key, repertoire_id,
           kind, answered_at, applied, received_at)
         values (gen_random_uuid(), 'p', 'k', gen_random_uuid(), 'guess', now(), true, now())`,
      ),
    ).rejects.toThrow(/review_results_kind_check/);
  });

  it('keys a result by player and result id: one id twice for a player is refused, for two players kept', async () => {
    await insertAccount('q');
    const insert = (playerId: string) =>
      client.query(
        `insert into review_results (result_id, player_id, move_key, repertoire_id,
           kind, answered_at, applied, received_at)
         values ('00000000-0000-4000-8000-000000000001', $1, 'k',
           gen_random_uuid(), 'pass', now(), true, now())`,
        [playerId],
      );
    await insert('p');
    await insert('q');
    expect(await count('review_results')).toBe(2);
    await expect(insert('p')).rejects.toThrow(
      /review_results_player_result_pk/,
    );
  });

  it('removes the reviews and results with the account', async () => {
    await insertReview('p', 'k', LEARNED);
    await insertResult('p');
    await client.query(`delete from accounts where id = 'p'`);
    expect(await count('reviews')).toBe(0);
    expect(await count('review_results')).toBe(0);
  });
});

describe('the training settings on accounts', () => {
  it('defaults to sessions of 20 and 10 new moves a day', async () => {
    await insertAccount('p');
    const { rows } = await client.query(
      'select session_size, new_per_day from accounts',
    );
    expect(rows).toEqual([{ session_size: 20, new_per_day: 10 }]);
  });

  it.each([
    ['session_size', 9, /accounts_session_size_check/],
    ['session_size', 101, /accounts_session_size_check/],
    ['new_per_day', -1, /accounts_new_per_day_check/],
    ['new_per_day', 51, /accounts_new_per_day_check/],
  ] as const)('refuses %s %i', async (column, value, check) => {
    await insertAccount('p');
    await expect(
      client.query(`update accounts set ${column} = $1`, [value]),
    ).rejects.toThrow(check);
  });

  it.each([
    ['session_size', 10],
    ['session_size', 100],
    ['new_per_day', 0],
    ['new_per_day', 50],
  ] as const)('accepts %s %i', async (column, value) => {
    await insertAccount('p');
    await client.query(`update accounts set ${column} = $1`, [value]);
    const { rows } = await client.query(`select ${column} as v from accounts`);
    expect(rows).toEqual([{ v: value }]);
  });
});
