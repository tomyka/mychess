/**
 * The games of the broadcast index (#316, #349): the one-transaction write
 * of a claimed month's or tournament's games, and the FIDE ID search over
 * both. Which games the index keeps is the domain's broadcastGameSchema;
 * how a game looks from the searched player's side is gameForPlayer; which
 * tournaments a search covers is broadcastWindowStart.
 */
import {
  BROADCAST_RESULTS,
  broadcastGameSchema,
  broadcastMonthSchema,
  broadcastTourIdSchema,
  broadcastWindowStart,
  fideIdSchema,
  gameForPlayer,
  ok,
  type BroadcastGame,
  type BroadcastGameInput,
  type BroadcastMonth,
  type BroadcastTourId,
  type BroadcastWindow,
  type FideId,
  type PlayerGame,
  type Result,
} from '@mychess/domain';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import {
  finishIndexEntry,
  heldIndexStatus,
  type IndexClaim,
  type IndexStateStore,
} from './broadcast-index-state';
import { broadcastGames, broadcastTours } from './broadcast-schema';
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

/** A game a search found, from the searched player's side (R-185). */
export interface FoundGame extends PlayerGame {
  readonly url: string;
  readonly source: BroadcastGameSource;
  /**
   * From a dump month or an official tournament; a community copy of an
   * official game gives way to it (preferOfficialCopies).
   */
  readonly official: boolean;
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

/**
 * What a search covers: the dump months it reads, and the window whose
 * tournaments it reads (none: no tournament).
 */
export interface BroadcastSearchScope {
  readonly months: readonly BroadcastMonth[];
  readonly window: BroadcastWindow | null;
}

/** The most games one search gives (security L1). */
export const FOUND_GAMES_LIMIT = 1000;

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
 * Inserts a chunk of games; a link already stored keeps its first source
 * (security M1), but a month's game replaces a tournament's: the dump's
 * official data wins over a community copy. A tournament's game replaces
 * nothing, and a month's no other month's.
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
        setWhere: isNotNull(broadcastGames.tourId),
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

const gameRowsSchema = z.array(
  z.object({
    url: z.string(),
    month: broadcastMonthSchema.nullable(),
    tourId: broadcastTourIdSchema.nullable(),
    tourOfficial: z.boolean().nullable(),
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
type GameRow = z.infer<typeof gameRowsSchema>[number];

const gameColumns = {
  url: broadcastGames.gameUrl,
  month: broadcastGames.month,
  tourId: broadcastGames.tourId,
  tourOfficial: broadcastTours.official,
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

/**
 * The UTC month a game is listed under: its dump month, or its
 * tournament's last round's.
 */
const listedMonth = sql`coalesce(${broadcastGames.month}, to_char(${broadcastTours.lastRoundAt} at time zone 'UTC', 'YYYY-MM'))`;

/**
 * The games the player with `id` played in `scope`'s months and in the
 * tournaments whose last round is in its window, newest month first, then
 * newest date, undated last (R-185): at most FOUND_GAMES_LIMIT, and
 * `truncated` when there were more. Each says whether it is official.
 */
export async function gamesForFideId(
  db: Executor,
  id: FideId,
  scope: BroadcastSearchScope,
): Promise<FoundGames> {
  const sources = scopeCondition(scope);
  if (sources === undefined) return { games: [], truncated: false };
  const rows = gameRowsSchema.parse(
    await db
      .select(gameColumns)
      .from(broadcastGames)
      .leftJoin(
        broadcastTours,
        eq(broadcastTours.tourId, broadcastGames.tourId),
      )
      .where(
        and(
          sources,
          or(
            eq(broadcastGames.whiteFideId, id),
            eq(broadcastGames.blackFideId, id),
          ),
        ),
      )
      .orderBy(
        sql`${listedMonth} desc`,
        sql`${broadcastGames.date} desc nulls last`,
        broadcastGames.gameUrl,
      )
      .limit(FOUND_GAMES_LIMIT + 1),
  );
  const games = rows
    .slice(0, FOUND_GAMES_LIMIT)
    .map((row) => foundGame(row, id));
  return { games, truncated: rows.length > FOUND_GAMES_LIMIT };
}

/** The games `scope` covers; undefined when it covers none. */
function scopeCondition(scope: BroadcastSearchScope): SQL | undefined {
  const conditions: SQL[] = [];
  if (scope.months.length > 0) {
    conditions.push(inArray(broadcastGames.month, [...scope.months]));
  }
  if (scope.window !== null) {
    const tours = and(
      isNotNull(broadcastGames.tourId),
      gte(broadcastTours.lastRoundAt, broadcastWindowStart(scope.window)),
    );
    if (tours !== undefined) conditions.push(tours);
  }
  return or(...conditions);
}

function foundGame(row: GameRow, id: FideId): FoundGame {
  return {
    url: row.url,
    ...sourceOf(row),
    date: row.date,
    event: row.event,
    eco: row.eco,
    opening: row.opening,
    ...gameForPlayer(row, id),
  };
}

/** A row's source; the table's check gives it exactly one. */
function sourceOf(row: GameRow): Pick<FoundGame, 'source' | 'official'> {
  if (row.month !== null) {
    return { source: { kind: 'month', month: row.month }, official: true };
  }
  if (row.tourId === null || row.tourOfficial === null) {
    throw new RangeError(`game ${row.url} has no month or tournament`);
  }
  return {
    source: { kind: 'tour', tourId: row.tourId },
    official: row.tourOfficial,
  };
}
