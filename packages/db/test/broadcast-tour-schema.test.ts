import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../src/testing';

const { client } = useTestDatabase();

interface TourRow {
  readonly id?: string;
  readonly name?: string;
  readonly organiser?: string | null;
  readonly state?: string;
}

/** A synthetic pending tournament row of an organiser, unless overridden. */
const insertTour = ({
  id = 'Ab3dEf7h',
  name = 'Synthetic Open',
  organiser = 'paulauskas',
  state = 'pending',
}: TourRow = {}) =>
  client.query(
    `insert into broadcast_tours (tour_id, name, organiser, official,
       last_round_at, state, attempts)
     values ($1, $2, $3, false, '2026-03-01T10:00:00Z', $4, 0)`,
    [id, name, organiser, state],
  );

/** A game row of `source`: a month, a tournament, both or neither. */
const insertGame = (url: string, month: string | null, tourId: string | null) =>
  client.query(
    `insert into broadcast_games (game_url, month, tour_id, white_fide_id,
       black_fide_id, white, black, date, result, event)
     values ($1, $2, $3, 100, 200, 'W', 'B', '2026-03-01', '1-0', 'Synthetic')`,
    [url, month, tourId],
  );

const gameCount = async (): Promise<number> => {
  const { rows } = await client.query<{ n: number }>(
    'select count(*)::int as n from broadcast_games',
  );
  return rows[0]?.n ?? -1;
};

describe('the broadcast tours table (#349, spec decision 1; R-201)', () => {
  it("keeps an organiser's tournament", async () => {
    await insertTour();
    const { rows } = await client.query(
      'select tour_id, organiser, state from broadcast_tours',
    );
    expect(rows).toEqual([
      { tour_id: 'Ab3dEf7h', organiser: 'paulauskas', state: 'pending' },
    ]);
  });

  it("keeps no origin: every tournament is an organiser's (R-201)", async () => {
    const { rows } = await client.query(
      `select column_name from information_schema.columns
       where table_name = 'broadcast_tours' and column_name = 'origin'`,
    );
    expect(rows).toEqual([]);
  });

  it('refuses a tournament without its organiser', async () => {
    await expect(insertTour({ organiser: null })).rejects.toThrow(
      /null value in column "organiser"/,
    );
  });

  it.each(['Ab3dEf7', 'Ab3dEf7hX', 'Ab3d-f7h', "Ab3d'f7h"])(
    'refuses the tournament id %j',
    async (id) => {
      await expect(insertTour({ id })).rejects.toThrow(
        /broadcast_tours_tour_id_check/,
      );
    },
  );

  it.each(['', 'x'.repeat(201)])('refuses a name of %#', async (name) => {
    await expect(insertTour({ name })).rejects.toThrow(
      /broadcast_tours_name_check/,
    );
  });

  it.each([
    ['an account not in lower case', 'Paulauskas'],
    ['an account that is no Lichess name', "x' or 1=1"],
  ])('refuses %s', async (_, organiser) => {
    await expect(insertTour({ organiser })).rejects.toThrow(
      /broadcast_tours_organiser_check/,
    );
  });

  it.each([
    ['processing', 'broadcast_tours_claimed_check'],
    ['done', 'broadcast_tours_done_check'],
    ['failed', 'broadcast_tours_failed_check'],
  ])('refuses a %s tournament without its time', async (state, check) => {
    await expect(insertTour({ state })).rejects.toThrow(new RegExp(check));
  });
});

describe('the source of a broadcast game (#349, spec decision 1)', () => {
  it('keeps a game of a month or of a tournament', async () => {
    await client.query(
      `insert into broadcast_months (month, state, attempts) values ('2026-03', 'pending', 0)`,
    );
    await insertTour();
    await insertGame('https://lichess.org/broadcast/-/-/a', '2026-03', null);
    await insertGame('https://lichess.org/broadcast/-/-/b', null, 'Ab3dEf7h');
    expect(await gameCount()).toBe(2);
  });

  it('refuses a game of both a month and a tournament, or of neither', async () => {
    await client.query(
      `insert into broadcast_months (month, state, attempts) values ('2026-03', 'pending', 0)`,
    );
    await insertTour();
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', '2026-03', 'Ab3dEf7h'),
    ).rejects.toThrow(/broadcast_games_source_check/);
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/b', null, null),
    ).rejects.toThrow(/broadcast_games_source_check/);
  });

  it('refuses a game of a tournament it does not know', async () => {
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', null, 'Ab3dEf7h'),
    ).rejects.toThrow(/broadcast_games_tour_id_/);
  });

  it("drops a tournament's games with the tournament", async () => {
    await insertTour();
    await insertGame('https://lichess.org/broadcast/-/-/a', null, 'Ab3dEf7h');
    await client.query(`delete from broadcast_tours`);
    expect(await gameCount()).toBe(0);
  });
});
