import { describe, expect, it } from 'vitest';
import { broadcastGames } from '../src/broadcast-schema';
import { matches } from '../src/schema-columns';
import { useTestDatabase } from '../src/testing';

const { client, db } = useTestDatabase();

/** A month row with no times or game count, unless `processed` sets processed_at. */
const insertMonth = (month: string, state = 'pending', processed = false) =>
  client.query(
    `insert into broadcast_months (month, state, attempts, processed_at)
     values ($1, $2, 0, case when $3 then now() end)`,
    [month, state, processed],
  );

/** A game row in month 2025-01; the FIDE IDs and the result vary. */
const insertGame = (
  url: string,
  white: number | null,
  black: number | null,
  result = '1-0',
) =>
  client.query(
    `insert into broadcast_games (game_url, month, white_fide_id, black_fide_id,
       white, black, date, result, eco, opening, event)
     values ($1, '2025-01', $2, $3, 'W', 'B', '2025-01-05', $4, 'B90',
       'Sicilian Defense', 'Synthetic Open')`,
    [url, white, black, result],
  );

describe('the broadcast months table (#316, spec decision 1)', () => {
  it('keeps a pending month', async () => {
    await insertMonth('2025-01');
    const { rows } = await client.query(
      'select state, attempts, game_count from broadcast_months',
    );
    expect(rows).toEqual([{ state: 'pending', attempts: 0, game_count: null }]);
  });

  it.each(['2025-13', '2025-1', '25-01', '2025-01-01'])(
    'refuses the month %j',
    async (month) => {
      await expect(insertMonth(month)).rejects.toThrow(
        /broadcast_months_month_check/,
      );
    },
  );

  it('refuses a state that does not exist', async () => {
    await expect(insertMonth('2025-01', 'lost')).rejects.toThrow(
      /broadcast_months_state_check/,
    );
  });

  it.each([
    ['processing', 'broadcast_months_claimed_check'],
    ['done', 'broadcast_months_done_check'],
    ['failed', 'broadcast_months_failed_check'],
  ])('refuses a %s month without its time', async (state, constraint) => {
    await expect(insertMonth('2025-01', state)).rejects.toThrow(
      new RegExp(constraint),
    );
  });

  it('refuses a done month without its game count', async () => {
    await expect(insertMonth('2025-01', 'done', true)).rejects.toThrow(
      /broadcast_months_done_check/,
    );
  });
});

describe('the broadcast games table (#316, spec decision 1)', () => {
  it('keeps a game with one or two FIDE IDs', async () => {
    await insertMonth('2025-01');
    await insertGame('https://lichess.org/broadcast/-/-/a', 100, 200);
    await insertGame('https://lichess.org/broadcast/-/-/b', 100, null);
    await insertGame('https://lichess.org/broadcast/-/-/c', null, 200);
    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from broadcast_games',
    );
    expect(rows[0]?.n).toBe(3);
  });

  it('refuses a game with the same FIDE ID on both sides', async () => {
    await insertMonth('2025-01');
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', 100, 100),
    ).rejects.toThrow(/broadcast_games_sides_check/);
  });

  it('refuses a game without any FIDE ID', async () => {
    await insertMonth('2025-01');
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', null, null),
    ).rejects.toThrow(/broadcast_games_fide_id_check/);
  });

  it.each([0, -5])('refuses the FIDE ID %d', async (id) => {
    await insertMonth('2025-01');
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', id, 200),
    ).rejects.toThrow(/broadcast_games_fide_id_check/);
  });

  it('refuses a result that does not exist', async () => {
    await insertMonth('2025-01');
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', 100, 200, '2-0'),
    ).rejects.toThrow(/broadcast_games_result_check/);
  });

  it('refuses a second game with the same URL', async () => {
    await insertMonth('2025-01');
    await insertGame('https://lichess.org/broadcast/-/-/a', 100, 200);
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', 300, 400),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a game of a month it does not know', async () => {
    await expect(
      insertGame('https://lichess.org/broadcast/-/-/a', 100, 200),
    ).rejects.toThrow(/broadcast_games_month_/);
  });

  it("drops a month's games with the month", async () => {
    await insertMonth('2025-01');
    await insertGame('https://lichess.org/broadcast/-/-/a', 100, 200);
    await client.query(`delete from broadcast_months where month = '2025-01'`);
    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from broadcast_games',
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('the broadcast game link (#316, security M1)', () => {
  it.each([
    'javascript:alert(1)',
    'http://lichess.org/AbCd1234',
    'https://example.com/AbCd1234',
    'https://lichess.org.example.com/AbCd1234',
    'https://lichess.org/a?b=c',
    'https://lichess.org/a b',
    'https://lichess.org/a"b',
    "https://lichess.org/a'b",
    'https://lichess.org/a<b>',
    'https://lichess.org/',
  ])('refuses %j', async (url) => {
    await insertMonth('2025-01');
    await expect(insertGame(url, 100, 200)).rejects.toThrow(
      /broadcast_games_url_check/,
    );
  });
});

describe('the broadcast game link through drizzle (security F1)', () => {
  it('refuses a non-Lichess link written past writeBroadcastMonth', async () => {
    await insertMonth('2025-01');
    // drizzle raises the pg error as its cause.
    await expect(
      db.insert(broadcastGames).values({
        gameUrl: 'https://example.com/AbCd1234',
        month: '2025-01',
        whiteFideId: 100,
        blackFideId: 200,
        white: 'W',
        black: 'B',
        result: '1-0',
        event: 'Synthetic Open',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'broadcast_games_url_check' },
    });
  });
});

describe('matches (security L5)', () => {
  it('refuses a pattern with a quote, which would end the inlined literal', () => {
    expect(() => matches(broadcastGames.gameUrl, "^a'b$")).toThrow(RangeError);
  });
});
