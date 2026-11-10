import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fideIdSchema,
  broadcastMonthSchema,
  type BroadcastGameInput,
  type FideId,
  type BroadcastMonth,
} from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  FOUND_GAMES_LIMIT,
  claimBroadcastMonth,
  failBroadcastMonth,
  gamesForFideId,
  broadcastMonthStatuses,
  releaseInterruptedBroadcastMonths,
  writeBroadcastMonth,
  type BroadcastMonthClaim,
} from '../src';
import { MIGRATIONS_FOLDER } from '../src/migrations';
import { useTestDatabase } from '../src/testing';

const { db, client } = useTestDatabase();

const MINUTE = 60_000;
const NOW = new Date('2026-11-09T12:00:00Z');
const later = (ms: number): Date => new Date(NOW.getTime() + ms);

const month = (text: string): BroadcastMonth =>
  broadcastMonthSchema.parse(text);
const months = (...texts: string[]): BroadcastMonth[] => texts.map(month);
const id = (n: number): FideId => fideIdSchema.parse(n);

/** A synthetic broadcast game: no real players (CLAUDE.md). */
const game = (
  n: number,
  overrides: Partial<BroadcastGameInput> = {},
): BroadcastGameInput => ({
  url: `https://lichess.org/broadcast/synthetic/round/game${String(n)}`,
  white: `White ${String(n)}`,
  whiteFideId: 100,
  black: `Black ${String(n)}`,
  blackFideId: 200,
  date: '2025-01-05',
  result: '1-0',
  eco: 'B90',
  opening: 'Sicilian Defense: Najdorf Variation',
  event: 'Synthetic Open',
  ...overrides,
});

const gamesNumbered = (count: number): BroadcastGameInput[] =>
  Array.from({ length: count }, (_, n) => game(n));

/** Claims `text`'s month at `at` and fails the test if it is refused. */
async function claimed(text: string, at = NOW): Promise<BroadcastMonthClaim> {
  const claim = await claimBroadcastMonth(db, month(text), at);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  return claim.value;
}

/** Claims `text`'s month at NOW and writes `games` into it at NOW. */
async function written(
  text: string,
  games: readonly BroadcastGameInput[],
): Promise<void> {
  const result = await writeBroadcastMonth(db, {
    claim: await claimed(text),
    games,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(`write refused: ${result.refusal.reason}`);
}

async function gameCount(): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    'select count(*)::int as n from broadcast_games',
  );
  return rows[0]?.n ?? -1;
}

/** The game count stored on `text`'s month row. */
async function storedGameCount(text: string): Promise<number | null> {
  const { rows } = await client.query<{ game_count: number | null }>(
    'select game_count from broadcast_months where month = $1',
    [text],
  );
  return rows[0]?.game_count ?? null;
}

async function stateOf(text: string): Promise<string | undefined> {
  const [entry] = await broadcastMonthStatuses(db, months(text));
  return entry?.status.state;
}

/** A promise and the function that settles it, for pacing a stream. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const pause = (ms: number): Promise<void> =>
  new Promise((settle) => setTimeout(settle, ms));

describe('broadcastMonthStatuses (#316, spec decision 5)', () => {
  it('gives a month never seen as pending, in the order asked', async () => {
    await claimed('2025-02');
    expect(
      await broadcastMonthStatuses(db, months('2025-01', '2025-02')),
    ).toEqual([
      {
        month: '2025-01',
        status: { state: 'pending', attempts: 0, lastFailedAt: null },
      },
      {
        month: '2025-02',
        status: { state: 'processing', attempts: 1, since: NOW },
      },
    ]);
  });

  it('gives nothing for no months', async () => {
    expect(await broadcastMonthStatuses(db, [])).toEqual([]);
  });
});

describe('claimBroadcastMonth (#316, spec decision 3)', () => {
  it('claims a month never seen as its first attempt', async () => {
    expect(await claimBroadcastMonth(db, month('2025-01'), NOW)).toEqual({
      ok: true,
      value: { month: '2025-01', claimedAt: NOW },
    });
  });

  it('lets exactly one of several concurrent searches claim a month', async () => {
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        claimBroadcastMonth(db, month('2025-01'), NOW),
      ),
    );
    expect(claims.filter((claim) => claim.ok)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.ok)).toEqual(
      Array.from({ length: 4 }, () => ({
        ok: false,
        refusal: { reason: 'fide.monthNotClaimable' },
      })),
    );
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({
      state: 'processing',
      attempts: 1,
      since: NOW,
    });
  });

  it('refuses a month being processed', async () => {
    await claimed('2025-01');
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(MINUTE)),
    ).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthNotClaimable' },
    });
  });

  it('claims a month whose processing went stale as one more attempt', async () => {
    await claimed('2025-01');
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(25 * MINUTE)),
    ).toEqual({
      ok: true,
      value: { month: '2025-01', claimedAt: later(25 * MINUTE) },
    });
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status.attempts).toBe(2);
  });

  it('refuses a done month', async () => {
    await written('2025-01', [game(1)]);
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(MINUTE)),
    ).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthNotClaimable' },
    });
  });

  it('refuses a stale month while its write still streams, then lets the write finish (security L3)', async () => {
    const claim = await claimed('2025-01');
    const streaming = deferred();
    const release = deferred();
    async function* stream(): AsyncGenerator<BroadcastGameInput> {
      yield game(1);
      streaming.resolve();
      await release.promise;
      yield game(2);
    }
    const writing = writeBroadcastMonth(db, {
      claim,
      games: stream(),
      clock: () => NOW,
    });
    await streaming.promise;
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(25 * MINUTE)),
    ).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthNotClaimable' },
    });
    release.resolve();
    expect(await writing).toEqual({
      ok: true,
      value: { gameCount: 2, skipped: 0 },
    });
    expect(await stateOf('2025-01')).toBe('done');
  });
});

describe('writeBroadcastMonth (#316, spec decision 2)', () => {
  it("writes a month's games and marks it done", async () => {
    const claim = await claimed('2025-01');
    expect(
      await writeBroadcastMonth(db, {
        claim,
        games: [game(1), game(2)],
        clock: () => later(MINUTE),
      }),
    ).toEqual({ ok: true, value: { gameCount: 2, skipped: 0 } });
    expect(await gameCount()).toBe(2);
    expect(await storedGameCount('2025-01')).toBe(2);
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({
      state: 'done',
      attempts: 1,
      since: later(MINUTE),
    });
  });

  it('skips and counts the games it refuses, writing the rest (security M3)', async () => {
    const claim = await claimed('2025-01');
    const kept = await writeBroadcastMonth(db, {
      claim,
      games: [
        game(1),
        game(2, { whiteFideId: null, blackFideId: null }),
        game(3, { whiteFideId: 100, blackFideId: 100 }),
        game(4, { url: 'javascript:alert(1)' }),
        game(5, { url: 'https://example.com/game5' }),
        game(6, { date: '2025-02-30' }),
        game(7, { white: 'A\u0000B' }),
        game(8, { event: 'x'.repeat(201) }),
        game(9, { blackFideId: -5 }),
        game(10, { white: '  Trimmed  ' }),
      ],
      clock: () => NOW,
    });
    expect(kept).toEqual({ ok: true, value: { gameCount: 2, skipped: 8 } });
    const { rows } = await client.query<{ white: string }>(
      'select white from broadcast_games order by white',
    );
    expect(rows.map((row) => row.white)).toEqual(['Trimmed', 'White 1']);
    expect(await storedGameCount('2025-01')).toBe(2);
  });

  it('reads the clock once every game is in (architect F2)', async () => {
    let streamed = false;
    function* stream(): Generator<BroadcastGameInput> {
      yield game(1);
      streamed = true;
    }
    const finishedAt: boolean[] = [];
    await writeBroadcastMonth(db, {
      claim: await claimed('2025-01'),
      games: stream(),
      clock: () => {
        finishedAt.push(streamed);
        return later(5 * MINUTE);
      },
    });
    expect(finishedAt).toEqual([true]);
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({
      state: 'done',
      attempts: 1,
      since: later(5 * MINUTE),
    });
  });

  it('reads the games from an async stream', async () => {
    async function* stream(): AsyncGenerator<BroadcastGameInput> {
      await Promise.resolve();
      yield game(1);
      yield game(2);
    }
    const write = await writeBroadcastMonth(db, {
      claim: await claimed('2025-01'),
      games: stream(),
      clock: () => NOW,
    });
    expect(write).toEqual({ ok: true, value: { gameCount: 2, skipped: 0 } });
  });

  it('writes nothing and leaves the month processing when the stream fails midway', async () => {
    const claim = await claimed('2025-01');
    function* failing(): Generator<BroadcastGameInput> {
      yield* gamesNumbered(1200);
      throw new Error('connection reset');
    }
    await expect(
      writeBroadcastMonth(db, { claim, games: failing(), clock: () => NOW }),
    ).rejects.toThrow('connection reset');
    expect(await gameCount()).toBe(0);
    expect(await stateOf('2025-01')).toBe('processing');
  });

  it('rolls back a write whose stream stalls past the idle limit (security M2a)', async () => {
    const claim = await claimed('2025-01');
    async function* stalling(): AsyncGenerator<BroadcastGameInput> {
      yield* gamesNumbered(600);
      await pause(1_500);
      yield game(600);
    }
    await expect(
      writeBroadcastMonth(
        db,
        { claim, games: stalling(), clock: () => NOW },
        { idleTimeoutMs: 300 },
      ),
    ).rejects.toThrow();
    expect(await gameCount()).toBe(0);
    expect(await stateOf('2025-01')).toBe('processing');
  });

  it('refuses an idle limit that is not a positive whole number of milliseconds', async () => {
    const claim = await claimed('2025-01');
    await expect(
      writeBroadcastMonth(
        db,
        { claim, games: [], clock: () => NOW },
        { idleTimeoutMs: 0.5 },
      ),
    ).rejects.toThrow(RangeError);
  });

  it('writes a month again without doubling its games', async () => {
    await written('2025-01', [game(1), game(2)]);
    // An operator resets the month (operations.md, task 6).
    await client.query(
      `update broadcast_months set state = 'pending' where month = '2025-01'`,
    );
    const again = await writeBroadcastMonth(db, {
      claim: await claimed('2025-01', later(MINUTE)),
      games: [game(1), game(2), game(3)],
      clock: () => later(2 * MINUTE),
    });
    expect(again).toEqual({ ok: true, value: { gameCount: 3, skipped: 0 } });
    expect(await gameCount()).toBe(3);
  });

  it('keeps a game listed in two months once', async () => {
    await written('2025-01', [game(1)]);
    await written('2025-02', [game(1)]);
    expect(await gameCount()).toBe(1);
    // Counted for both months, stored under the first.
    expect(await storedGameCount('2025-02')).toBe(1);
  });

  it('refuses, writing nothing, once a later claim took the stale month over', async () => {
    const first = await claimed('2025-01');
    await claimed('2025-01', later(25 * MINUTE));
    expect(
      await writeBroadcastMonth(db, {
        claim: first,
        games: [game(1)],
        clock: () => later(26 * MINUTE),
      }),
    ).toEqual({ ok: false, refusal: { reason: 'fide.monthClaimLost' } });
    expect(await gameCount()).toBe(0);
  });
});

describe('failBroadcastMonth (#316, spec decision 2, R-188)', () => {
  const failedAt = async (): Promise<Date | null> => {
    const { rows } = await client.query<{ failed_at: Date | null }>(
      `select failed_at from broadcast_months where month = '2025-01'`,
    );
    return rows[0]?.failed_at ?? null;
  };

  it('leaves a month pending after its first failed attempt, with the time it failed', async () => {
    const claim = await claimed('2025-01');
    expect(await failBroadcastMonth(db, claim, later(MINUTE))).toEqual({
      ok: true,
      value: { state: 'pending', attempts: 1, lastFailedAt: later(MINUTE) },
    });
    expect(await failedAt()).toEqual(later(MINUTE));
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({
      state: 'pending',
      attempts: 1,
      lastFailedAt: later(MINUTE),
    });
  });

  it('refuses a claim under 10 minutes after a failed attempt and allows it at 10 minutes (R-188)', async () => {
    await failBroadcastMonth(db, await claimed('2025-01'), NOW);
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(10 * MINUTE - 1)),
    ).toEqual({ ok: false, refusal: { reason: 'fide.monthNotClaimable' } });
    expect(
      (await claimBroadcastMonth(db, month('2025-01'), later(10 * MINUTE))).ok,
    ).toBe(true);
  });

  it('fails a month after its third failed attempt, for a day', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const at = later(attempt * 10 * MINUTE);
      await failBroadcastMonth(db, await claimed('2025-01', at), at);
    }
    const failedAtTime = later(20 * MINUTE);
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({
      state: 'failed',
      attempts: 3,
      since: failedAtTime,
    });
    expect(await failedAt()).toEqual(failedAtTime);
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(30 * MINUTE)),
    ).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthNotClaimable' },
    });
    expect(
      (
        await claimBroadcastMonth(
          db,
          month('2025-01'),
          later(20 * MINUTE + 24 * 60 * MINUTE),
        )
      ).ok,
    ).toBe(true);
  });

  it('refuses once a later claim took the stale month over', async () => {
    const first = await claimed('2025-01');
    await claimed('2025-01', later(25 * MINUTE));
    expect(await failBroadcastMonth(db, first, later(26 * MINUTE))).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthClaimLost' },
    });
    expect(await stateOf('2025-01')).toBe('processing');
  });
});

/** A month row as stored, every column. */
interface StoredMonth {
  readonly month: string;
  readonly state: string;
  readonly attempts: number;
  readonly game_count: number | null;
  readonly claimed_at: Date | null;
  readonly failed_at: Date | null;
  readonly processed_at: Date | null;
}

/** Stores `row` as it is, bypassing the repositories. */
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

/** A done, a failed and a pending month, none of them processing. */
async function storeSettledMonths(): Promise<void> {
  await store({
    month: '2025-01',
    state: 'done',
    attempts: 2,
    game_count: 7,
    claimed_at: later(-3 * MINUTE),
    processed_at: later(-MINUTE),
  });
  await store({
    month: '2025-02',
    state: 'failed',
    attempts: 3,
    claimed_at: later(-3 * MINUTE),
    failed_at: later(-2 * MINUTE),
  });
  await store({
    month: '2025-03',
    state: 'pending',
    attempts: 1,
    claimed_at: later(-3 * MINUTE),
    failed_at: later(-2 * MINUTE),
  });
}

describe('releaseInterruptedBroadcastMonths (#355)', () => {
  it('makes a month a previous process left processing pending again, refunding its attempt', async () => {
    await store({
      month: '2025-01',
      state: 'processing',
      attempts: 2,
      claimed_at: later(-5 * MINUTE),
      failed_at: later(-60 * MINUTE),
    });
    await claimed('2025-02', later(-MINUTE));
    expect(await releaseInterruptedBroadcastMonths(db, NOW)).toBe(2);
    expect(
      await broadcastMonthStatuses(db, months('2025-01', '2025-02')),
    ).toEqual([
      {
        month: '2025-01',
        status: {
          state: 'pending',
          attempts: 1,
          lastFailedAt: later(-60 * MINUTE),
        },
      },
      {
        month: '2025-02',
        status: { state: 'pending', attempts: 0, lastFailedAt: null },
      },
    ]);
    expect((await claimBroadcastMonth(db, month('2025-02'), NOW)).ok).toBe(
      true,
    );
  });

  it('leaves a month claimed as this process started or later', async () => {
    await claimed('2025-01', NOW);
    await claimed('2025-02', later(MINUTE));
    const before = await storedMonths();
    expect(await releaseInterruptedBroadcastMonths(db, NOW)).toBe(0);
    expect(await storedMonths()).toEqual(before);
  });

  it('leaves a month whose write still holds its row', async () => {
    const claim = await claimed('2025-01', later(-5 * MINUTE));
    const streaming = deferred();
    const release = deferred();
    async function* stream(): AsyncGenerator<BroadcastGameInput> {
      yield game(1);
      streaming.resolve();
      await release.promise;
    }
    const writing = writeBroadcastMonth(db, {
      claim,
      games: stream(),
      clock: () => NOW,
    });
    await streaming.promise;
    expect(await releaseInterruptedBroadcastMonths(db, NOW)).toBe(0);
    release.resolve();
    expect(await writing).toEqual({
      ok: true,
      value: { gameCount: 1, skipped: 0 },
    });
    expect(await stateOf('2025-01')).toBe('done');
  });

  it('leaves done, failed and pending months as they are', async () => {
    await storeSettledMonths();
    const before = await storedMonths();
    expect(await releaseInterruptedBroadcastMonths(db, NOW)).toBe(0);
    expect(await storedMonths()).toEqual(before);
  });
});

describe('migration 0015 resets failed and processing months (#355)', () => {
  it('makes failed and processing months pending with no attempts, leaving done months, twice over', async () => {
    const migration = readFileSync(
      join(MIGRATIONS_FOLDER, '0015_reset_broadcast_months.sql'),
      'utf8',
    );
    await storeSettledMonths();
    await written('2025-04', [game(1)]);
    await store({
      month: '2025-05',
      state: 'processing',
      attempts: 2,
      claimed_at: later(-5 * MINUTE),
      failed_at: later(-60 * MINUTE),
    });
    const [done, , , doneWritten] = await storedMonths();
    await client.query(migration);
    await client.query(migration);
    const reset = {
      state: 'pending',
      attempts: 0,
      game_count: null,
      claimed_at: null,
      failed_at: null,
      processed_at: null,
    };
    expect(await storedMonths()).toEqual([
      done,
      { month: '2025-02', ...reset },
      {
        month: '2025-03',
        state: 'pending',
        attempts: 1,
        game_count: null,
        claimed_at: later(-3 * MINUTE),
        failed_at: later(-2 * MINUTE),
        processed_at: null,
      },
      doneWritten,
      { month: '2025-05', ...reset },
    ]);
    expect(await gameCount()).toBe(1);
    for (const text of ['2025-02', '2025-05'])
      expect((await claimBroadcastMonth(db, month(text), NOW)).ok).toBe(true);
  });
});

describe('gamesForFideId (#316, R-185)', () => {
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
      id(100),
      months('2025-01', '2025-02'),
    );
    expect(found).toEqual({
      truncated: false,
      games: [
        {
          url: game(4).url,
          month: '2025-02',
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
    const found = await gamesForFideId(db, id(100), months('2025-02'));
    expect(found.games.map((one) => one.url)).toEqual([game(2).url]);
  });

  it('puts a game without a date after the dated games of its month', async () => {
    await written('2025-01', [
      game(1, { date: null }),
      game(2, { date: '2025-01-03' }),
    ]);
    const found = await gamesForFideId(db, id(100), months('2025-01'));
    expect(found.games.map((one) => [one.url, one.date])).toEqual([
      [game(2).url, '2025-01-03'],
      [game(1).url, null],
    ]);
  });

  it('gives at most 1000 games and says when there were more (security L1)', async () => {
    expect(FOUND_GAMES_LIMIT).toBe(1000);
    await written('2025-01', gamesNumbered(FOUND_GAMES_LIMIT + 1));
    const found = await gamesForFideId(db, id(100), months('2025-01'));
    expect(found.games).toHaveLength(FOUND_GAMES_LIMIT);
    expect(found.truncated).toBe(true);
  });

  it('is not truncated at exactly the limit', async () => {
    await written('2025-01', gamesNumbered(FOUND_GAMES_LIMIT));
    const found = await gamesForFideId(db, id(100), months('2025-01'));
    expect(found.games).toHaveLength(FOUND_GAMES_LIMIT);
    expect(found.truncated).toBe(false);
  });

  it('gives nothing for no months', async () => {
    await written('2025-01', [game(1)]);
    expect(await gamesForFideId(db, id(100), [])).toEqual({
      games: [],
      truncated: false,
    });
  });
});
