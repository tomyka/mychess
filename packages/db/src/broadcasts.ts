/**
 * The FIDE ID search's broadcast index (#316): which months are ready, the
 * exclusive claim of a month to process it, the one-transaction write of a
 * month's games, and the search itself. The domain decides every state
 * change (decideBroadcastClaim, isBroadcastClaimHeld, decideBroadcastFinish, decideBroadcastFailure),
 * which games the index keeps (broadcastGameSchema) and how a game looks
 * from the searched player's side (gameForPlayer).
 */
import {
  BROADCAST_RESULTS,
  BROADCAST_MONTH_REFUSALS,
  broadcastGameSchema,
  decideBroadcastFailure,
  fideIdSchema,
  decideBroadcastFinish,
  gameForPlayer,
  isBroadcastClaimHeld,
  broadcastMonthSchema,
  ok,
  refuse,
  decideBroadcastClaim,
  type BroadcastGame,
  type BroadcastGameInput,
  type FideId,
  type BroadcastMonth,
  type BroadcastMonthRefusal,
  type BroadcastMonthStatus,
  type PlayerGame,
  type Result,
} from '@mychess/domain';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { broadcastGames, broadcastMonths } from './broadcast-schema';
import type { Executor, Tx } from './client';

/** A process's hold on a month it processes: the month and its claim time. */
export interface BroadcastMonthClaim {
  readonly month: BroadcastMonth;
  readonly claimedAt: Date;
}

/** A month and its index state. */
export interface BroadcastMonthEntry {
  readonly month: BroadcastMonth;
  readonly status: BroadcastMonthStatus;
}

/**
 * The games of a claimed month, from a list or a stream, and the clock that
 * says when the write finished: read once every game is in.
 */
export interface BroadcastMonthWrite {
  readonly claim: BroadcastMonthClaim;
  readonly games:
    Iterable<BroadcastGameInput> | AsyncIterable<BroadcastGameInput>;
  readonly clock: () => Date;
}

/**
 * How long a month's write may wait for its stream between statements
 * before Postgres ends the transaction (security M2a); two minutes unless
 * a test asks for less.
 */
export interface BroadcastWriteOptions {
  readonly idleTimeoutMs: number;
}

/** What a write kept and what it refused (broadcastGameSchema). */
export interface BroadcastWriteCount {
  readonly gameCount: number;
  readonly skipped: number;
}

/** A game a search found, from the searched player's side (R-185). */
export interface FoundGame extends PlayerGame {
  readonly url: string;
  readonly month: BroadcastMonth;
  readonly date: string | null;
  readonly event: string;
  readonly eco: string | null;
  readonly opening: string | null;
}

/** A search's games, and whether more were left out past the limit. */
export interface FoundGames {
  readonly games: FoundGame[];
  readonly truncated: boolean;
}

/** The most games one search gives (security L1). */
export const FOUND_GAMES_LIMIT = 1000;

const DEFAULT_WRITE_OPTIONS: BroadcastWriteOptions = { idleTimeoutMs: 120_000 };

/** Games per insert: 11 parameters each stays far below Postgres's 65,535. */
const GAME_CHUNK = 500;

const monthRowBase = {
  month: broadcastMonthSchema,
  attempts: z.number().int().nonnegative(),
};

/** A month row by its state, with the time that state keeps (the checks). */
const monthRowsSchema = z.array(
  z.discriminatedUnion('state', [
    z.object({
      ...monthRowBase,
      state: z.literal('pending'),
      failedAt: z.date().nullable(),
    }),
    z.object({
      ...monthRowBase,
      state: z.literal('processing'),
      claimedAt: z.date(),
    }),
    z.object({
      ...monthRowBase,
      state: z.literal('done'),
      processedAt: z.date(),
    }),
    z.object({
      ...monthRowBase,
      state: z.literal('failed'),
      failedAt: z.date(),
    }),
  ]),
);
type MonthRow = z.infer<typeof monthRowsSchema>[number];

const monthColumns = {
  month: broadcastMonths.month,
  state: broadcastMonths.state,
  attempts: broadcastMonths.attempts,
  claimedAt: broadcastMonths.claimedAt,
  failedAt: broadcastMonths.failedAt,
  processedAt: broadcastMonths.processedAt,
};

const gameRowsSchema = z.array(
  z.object({
    url: z.string(),
    month: broadcastMonthSchema,
    white: z.string(),
    whiteFideId: fideIdSchema.nullable(),
    black: z.string(),
    blackFideId: fideIdSchema.nullable(),
    date: z.string().nullable(),
    result: z.enum(BROADCAST_RESULTS),
    eco: z.string().nullable(),
    opening: z.string().nullable(),
    event: z.string(),
  }),
);

const gameColumns = {
  url: broadcastGames.gameUrl,
  month: broadcastGames.month,
  white: broadcastGames.white,
  whiteFideId: broadcastGames.whiteFideId,
  black: broadcastGames.black,
  blackFideId: broadcastGames.blackFideId,
  date: broadcastGames.date,
  result: broadcastGames.result,
  eco: broadcastGames.eco,
  opening: broadcastGames.opening,
  event: broadcastGames.event,
};

/** A stored month row as the domain's BroadcastMonthStatus. */
function toStatus(row: MonthRow): BroadcastMonthStatus {
  const { attempts } = row;
  switch (row.state) {
    case 'pending':
      return { state: row.state, attempts, lastFailedAt: row.failedAt };
    case 'processing':
      return { state: row.state, attempts, since: row.claimedAt };
    case 'done':
      return { state: row.state, attempts, since: row.processedAt };
    case 'failed':
      return { state: row.state, attempts, since: row.failedAt };
  }
}

/**
 * The columns that store `status`, the inverse of toStatus: its state, its
 * attempts and the one time its state keeps (for a pending month, its last
 * failure). The other times stay as they were.
 */
function statusColumns(
  status: BroadcastMonthStatus,
): Partial<typeof broadcastMonths.$inferInsert> {
  const { state, attempts } = status;
  switch (status.state) {
    case 'pending':
      return { state, attempts, failedAt: status.lastFailedAt };
    case 'processing':
      return { state, attempts, claimedAt: status.since };
    case 'done':
      return { state, attempts, processedAt: status.since };
    case 'failed':
      return { state, attempts, failedAt: status.since };
  }
}

/**
 * The index state of each of `months`, in the order given; a month no
 * search has needed yet is pending with no attempts.
 */
export async function broadcastMonthStatuses(
  db: Executor,
  months: readonly BroadcastMonth[],
): Promise<BroadcastMonthEntry[]> {
  if (months.length === 0) return [];
  const rows = monthRowsSchema.parse(
    await db
      .select(monthColumns)
      .from(broadcastMonths)
      .where(inArray(broadcastMonths.month, [...months])),
  );
  const known = new Map<string, BroadcastMonthStatus>(
    rows.map((row) => [row.month, toStatus(row)]),
  );
  return months.map((month) => ({
    month,
    status: known.get(month) ?? {
      state: 'pending',
      attempts: 0,
      lastFailedAt: null,
    },
  }));
}

/**
 * Claims `month` at `now` for this process to index (spec decision 3).
 * The row lock decides between concurrent searches: one that finds the row
 * locked, or the month not to be processed (decideBroadcastClaim), is refused.
 */
export async function claimBroadcastMonth(
  db: Executor,
  month: BroadcastMonth,
  now: Date,
): Promise<Result<BroadcastMonthClaim, BroadcastMonthRefusal>> {
  return db.transaction(async (tx) => {
    await tx
      .insert(broadcastMonths)
      .values({ month, state: 'pending', attempts: 0 })
      .onConflictDoNothing();
    const [row] = monthRowsSchema.parse(
      await tx
        .select(monthColumns)
        .from(broadcastMonths)
        .where(eq(broadcastMonths.month, month))
        .for('update', { skipLocked: true }),
    );
    if (row === undefined) return refuse(BROADCAST_MONTH_REFUSALS.notClaimable);
    const claimed = decideBroadcastClaim(toStatus(row), now);
    if (!claimed.ok) return claimed;
    await tx
      .update(broadcastMonths)
      .set(statusColumns(claimed.value))
      .where(eq(broadcastMonths.month, month));
    return ok({ month, claimedAt: now });
  });
}

/**
 * Writes the games of a claimed month and marks it done, in one
 * transaction (spec decision 2): a stream or insert that fails, or a stream
 * idle past `idleTimeoutMs`, leaves no game written and the month
 * processing. Each game is checked again (broadcastGameSchema); one it
 * refuses is skipped and counted. A game already indexed, by this month
 * before or by another, is kept as it is. Refused, writing nothing, when
 * the claim is no longer held.
 */
export async function writeBroadcastMonth(
  db: Executor,
  { claim, games, clock }: BroadcastMonthWrite,
  { idleTimeoutMs }: BroadcastWriteOptions = DEFAULT_WRITE_OPTIONS,
): Promise<Result<BroadcastWriteCount, BroadcastMonthRefusal>> {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1) {
    throw new RangeError(`idle timeout ${String(idleTimeoutMs)} ms`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('idle_in_transaction_session_timeout', ${`${String(idleTimeoutMs)}ms`}, true)`,
    );
    const held = await heldStatus(tx, claim);
    if (!held.ok) return held;
    const count = await insertGames(tx, claim.month, games);
    const done = decideBroadcastFinish(held.value, clock());
    await tx
      .update(broadcastMonths)
      .set({ ...statusColumns(done), gameCount: count.gameCount })
      .where(eq(broadcastMonths.month, claim.month));
    return ok(count);
  });
}

/**
 * Records at `now` that the claimed month's processing failed: pending
 * again, or failed after its last attempt (decideBroadcastFailure). Refused when
 * the claim is no longer held.
 */
export async function failBroadcastMonth(
  db: Executor,
  claim: BroadcastMonthClaim,
  now: Date,
): Promise<Result<BroadcastMonthStatus, BroadcastMonthRefusal>> {
  return db.transaction(async (tx) => {
    const held = await heldStatus(tx, claim);
    if (!held.ok) return held;
    const next = decideBroadcastFailure(held.value, now);
    await tx
      .update(broadcastMonths)
      .set(statusColumns(next))
      .where(eq(broadcastMonths.month, claim.month));
    return ok(next);
  });
}

/**
 * The games of `months` the player with `id` played, newest month first,
 * then newest date, undated last (R-185): at most FOUND_GAMES_LIMIT, and
 * `truncated` when there were more.
 */
export async function gamesForFideId(
  db: Executor,
  id: FideId,
  months: readonly BroadcastMonth[],
): Promise<FoundGames> {
  if (months.length === 0) return { games: [], truncated: false };
  const rows = gameRowsSchema.parse(
    await db
      .select(gameColumns)
      .from(broadcastGames)
      .where(
        and(
          inArray(broadcastGames.month, [...months]),
          or(
            eq(broadcastGames.whiteFideId, id),
            eq(broadcastGames.blackFideId, id),
          ),
        ),
      )
      .orderBy(
        desc(broadcastGames.month),
        sql`${broadcastGames.date} desc nulls last`,
        asc(broadcastGames.gameUrl),
      )
      .limit(FOUND_GAMES_LIMIT + 1),
  );
  const games = rows.slice(0, FOUND_GAMES_LIMIT).map((row) => ({
    url: row.url,
    month: row.month,
    date: row.date,
    event: row.event,
    eco: row.eco,
    opening: row.opening,
    ...gameForPlayer(row, id),
  }));
  return { games, truncated: rows.length > FOUND_GAMES_LIMIT };
}

/**
 * The claimed month's status, locked until the transaction ends, while
 * `claim` still holds it (isBroadcastClaimHeld); refused once it does not.
 */
async function heldStatus(
  tx: Tx,
  claim: BroadcastMonthClaim,
): Promise<Result<BroadcastMonthStatus, BroadcastMonthRefusal>> {
  const [row] = monthRowsSchema.parse(
    await tx
      .select(monthColumns)
      .from(broadcastMonths)
      .where(eq(broadcastMonths.month, claim.month))
      .for('update'),
  );
  const status = row === undefined ? undefined : toStatus(row);
  return status !== undefined && isBroadcastClaimHeld(status, claim.claimedAt)
    ? ok(status)
    : refuse(BROADCAST_MONTH_REFUSALS.claimLost);
}

/** Inserts the games the index keeps, in chunks, and counts the rest. */
async function insertGames(
  tx: Tx,
  month: BroadcastMonth,
  games: BroadcastMonthWrite['games'],
): Promise<BroadcastWriteCount> {
  let gameCount = 0;
  let skipped = 0;
  let chunk: (typeof broadcastGames.$inferInsert)[] = [];
  for await (const input of games) {
    const game = broadcastGameSchema.safeParse(input);
    if (!game.success) {
      skipped += 1;
      continue;
    }
    chunk.push(gameRow(month, game.data));
    gameCount += 1;
    if (chunk.length === GAME_CHUNK) {
      await insertChunk(tx, chunk);
      chunk = [];
    }
  }
  await insertChunk(tx, chunk);
  return { gameCount, skipped };
}

async function insertChunk(
  tx: Tx,
  rows: readonly (typeof broadcastGames.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(broadcastGames)
    .values([...rows])
    .onConflictDoNothing({ target: broadcastGames.gameUrl });
}

function gameRow(
  month: BroadcastMonth,
  game: BroadcastGame,
): typeof broadcastGames.$inferInsert {
  return {
    gameUrl: game.url,
    month,
    whiteFideId: game.whiteFideId,
    blackFideId: game.blackFideId,
    white: game.white,
    black: game.black,
    date: game.date,
    result: game.result,
    eco: game.eco,
    opening: game.opening,
    event: game.event,
  };
}
