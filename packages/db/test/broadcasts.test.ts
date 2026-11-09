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
  writeBroadcastMonth,
  type BroadcastMonthClaim,
} from '../src';
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
      { month: '2025-01', status: { state: 'pending', attempts: 0 } },
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
      await claimBroadcastMonth(db, month('2025-01'), later(16 * MINUTE)),
    ).toEqual({
      ok: true,
      value: { month: '2025-01', claimedAt: later(16 * MINUTE) },
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
      await claimBroadcastMonth(db, month('2025-01'), later(16 * MINUTE)),
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
    await claimed('2025-01', later(16 * MINUTE));
    expect(
      await writeBroadcastMonth(db, {
        claim: first,
        games: [game(1)],
        clock: () => later(17 * MINUTE),
      }),
    ).toEqual({ ok: false, refusal: { reason: 'fide.monthClaimLost' } });
    expect(await gameCount()).toBe(0);
  });
});

describe('failBroadcastMonth (#316, spec decision 2)', () => {
  it('leaves a month pending after its first failed attempt', async () => {
    const claim = await claimed('2025-01');
    expect(await failBroadcastMonth(db, claim, later(MINUTE))).toEqual({
      ok: true,
      value: { state: 'pending', attempts: 1 },
    });
    expect(
      (await claimBroadcastMonth(db, month('2025-01'), later(MINUTE))).ok,
    ).toBe(true);
  });

  it('stores a failure time only on a failed month (architect F1)', async () => {
    const failedAt = async (): Promise<Date | null> => {
      const { rows } = await client.query<{ failed_at: Date | null }>(
        `select failed_at from broadcast_months where month = '2025-01'`,
      );
      return rows[0]?.failed_at ?? null;
    };
    await failBroadcastMonth(db, await claimed('2025-01'), NOW);
    expect(await failedAt()).toBeNull();
    await failBroadcastMonth(db, await claimed('2025-01'), NOW);
    await failBroadcastMonth(db, await claimed('2025-01'), later(MINUTE));
    expect(await failedAt()).toEqual(later(MINUTE));
  });

  it('fails a month after its third failed attempt, for a day', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await failBroadcastMonth(db, await claimed('2025-01'), NOW);
    }
    const [entry] = await broadcastMonthStatuses(db, months('2025-01'));
    expect(entry?.status).toEqual({ state: 'failed', attempts: 3, since: NOW });
    expect(
      await claimBroadcastMonth(db, month('2025-01'), later(MINUTE)),
    ).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthNotClaimable' },
    });
    expect(
      (await claimBroadcastMonth(db, month('2025-01'), later(24 * 60 * MINUTE)))
        .ok,
    ).toBe(true);
  });

  it('refuses once a later claim took the stale month over', async () => {
    const first = await claimed('2025-01');
    await claimed('2025-01', later(16 * MINUTE));
    expect(await failBroadcastMonth(db, first, later(17 * MINUTE))).toEqual({
      ok: false,
      refusal: { reason: 'fide.monthClaimLost' },
    });
    expect(await stateOf('2025-01')).toBe('processing');
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
