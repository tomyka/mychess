/**
 * The games of the broadcast index (#316, #349): the one-transaction write
 * of a claimed month's or tournament's games. Which games the index keeps
 * is the domain's broadcastGameSchema; the search is broadcast-search.ts.
 */
import {
  broadcastGameSchema,
  ok,
  type BroadcastGame,
  type BroadcastGameInput,
  type BroadcastMonth,
  type BroadcastTourId,
  type Result,
} from '@mychess/domain';
import { isNotNull, sql } from 'drizzle-orm';
import {
  finishIndexEntry,
  heldIndexStatus,
  type IndexClaim,
  type IndexStateStore,
} from './broadcast-index-state';
import { broadcastGames } from './broadcast-schema';
import type { Executor, Tx } from './client';

/** Where a stored game came from: a dump month or a tournament. */
export type BroadcastGameSource =
  | { readonly kind: 'month'; readonly month: BroadcastMonth }
  | { readonly kind: 'tour'; readonly tourId: BroadcastTourId };

/** Games from a list or a stream. */
export type BroadcastGameStream =
  Iterable<BroadcastGameInput> | AsyncIterable<BroadcastGameInput>;

/**
 * How long a write may wait for its stream between statements before
 * Postgres ends the transaction (security M2a); two minutes unless a test
 * asks for less.
 */
export interface BroadcastWriteOptions {
  readonly idleTimeoutMs: number;
}

/** What a write kept and what it refused (broadcastGameSchema). */
export interface BroadcastWriteCount {
  readonly gameCount: number;
  readonly skipped: number;
}

export const DEFAULT_WRITE_OPTIONS: BroadcastWriteOptions = {
  idleTimeoutMs: 120_000,
};

/** Games per insert: 12 parameters each stays far below Postgres's 65,535. */
const GAME_CHUNK = 500;

/** A claimed entry's games and the clock read once every game is in. */
interface IndexWrite<K extends string> {
  readonly claim: IndexClaim<K>;
  readonly source: BroadcastGameSource;
  readonly games: BroadcastGameStream;
  /** Whether the entry keeps a valid game; one it does not is skipped. */
  readonly accepts: (game: BroadcastGame) => boolean;
  readonly clock: () => Date;
}

/**
 * Writes the games of a claimed entry and marks it done, in one
 * transaction (#316 spec decision 2): a stream or insert that fails, or a
 * stream idle past `idleTimeoutMs`, leaves no game written and the entry
 * processing. Each game is checked again (broadcastGameSchema); one it
 * refuses is skipped and counted. A game already indexed is kept as it is,
 * except that a month's write replaces a game a tournament stored (the
 * official dump wins, #349). Refused, writing nothing, when
 * the claim is no longer held.
 */
export async function writeIndexEntry<K extends string, R extends string>(
  db: Executor,
  store: IndexStateStore<K, R>,
  write: IndexWrite<K>,
  { idleTimeoutMs }: BroadcastWriteOptions,
): Promise<Result<BroadcastWriteCount, { readonly reason: R }>> {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1) {
    throw new RangeError(`idle timeout ${String(idleTimeoutMs)} ms`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('idle_in_transaction_session_timeout', ${`${String(idleTimeoutMs)}ms`}, true)`,
    );
    const held = await heldIndexStatus(tx, store, write.claim);
    if (!held.ok) return held;
    const count = await insertGames(tx, write);
    await finishIndexEntry(tx, store, {
      key: write.claim.key,
      held: held.value,
      at: write.clock(),
      gameCount: count.gameCount,
    });
    return ok(count);
  });
}

/** Inserts the games the index keeps, in chunks, and counts the rest. */
async function insertGames<K extends string>(
  tx: Tx,
  { source, games, accepts }: IndexWrite<K>,
): Promise<BroadcastWriteCount> {
  let gameCount = 0;
  let skipped = 0;
  let chunk: (typeof broadcastGames.$inferInsert)[] = [];
  for await (const input of games) {
    const game = broadcastGameSchema.safeParse(input);
    if (!game.success || !accepts(game.data)) {
      skipped += 1;
      continue;
    }
    chunk.push(gameRow(source, game.data));
    gameCount += 1;
    if (chunk.length === GAME_CHUNK) {
      await insertChunk(tx, source, chunk);
      chunk = [];
    }
  }
  await insertChunk(tx, source, chunk);
  return { gameCount, skipped };
}

/** Every column of a game but its link, as a conflicting insert gave it. */
const EXCLUDED_GAME = {
  month: sql`excluded.month`,
  tourId: sql`excluded.tour_id`,
  whiteFideId: sql`excluded.white_fide_id`,
  blackFideId: sql`excluded.black_fide_id`,
  white: sql`excluded.white`,
  black: sql`excluded.black`,
  date: sql`excluded.date`,
  result: sql`excluded.result`,
  eco: sql`excluded.eco`,
  opening: sql`excluded.opening`,
  event: sql`excluded.event`,
} satisfies Record<
  Exclude<keyof typeof broadcastGames.$inferInsert, 'gameUrl'>,
  unknown
>;

/**
 * Inserts a chunk of games; a link already stored keeps its source
 * (security M1), with two exceptions for a month's game. It replaces a
 * tournament's: the dump's official data wins over a community copy. It
 * replaces an older month's (#344): a game is kept by the newest month
 * that lists it, whatever order the months are indexed in, so it outlives
 * an older month leaving the window (pruneBroadcastIndex). A tournament's
 * game replaces nothing.
 */
async function insertChunk(
  tx: Tx,
  source: BroadcastGameSource,
  rows: readonly (typeof broadcastGames.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  const insert = tx.insert(broadcastGames).values([...rows]);
  await (source.kind === 'month'
    ? insert.onConflictDoUpdate({
        target: broadcastGames.gameUrl,
        set: EXCLUDED_GAME,
        setWhere: sql`${isNotNull(broadcastGames.tourId)} or ${broadcastGames.month} < excluded.month`,
      })
    : insert.onConflictDoNothing({ target: broadcastGames.gameUrl }));
}

function gameRow(
  source: BroadcastGameSource,
  game: BroadcastGame,
): typeof broadcastGames.$inferInsert {
  return {
    gameUrl: game.url,
    month: source.kind === 'month' ? source.month : null,
    tourId: source.kind === 'tour' ? source.tourId : null,
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
