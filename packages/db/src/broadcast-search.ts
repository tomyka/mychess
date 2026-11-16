/**
 * The FIDE ID search over the broadcast index (#316, #349): a player's
 * games in the dump months and the tournaments a search covers, without
 * the community copies of official games. How a game looks from the
 * searched player's side is the domain's gameForPlayer; which tournaments
 * a search covers is broadcastWindowStart; which games are copies is the
 * domain's rule of preferOfficialCopies, applied here in SQL so the limit
 * counts the games shown (an agreement test pins the two together).
 */
import {
  BROADCAST_RESULTS,
  broadcastMonthSchema,
  broadcastTourIdSchema,
  broadcastWindowStart,
  fideIdSchema,
  gameForPlayer,
  type BroadcastMonth,
  type BroadcastWindow,
  type FideId,
  type PlayerGame,
} from '@mychess/domain';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { BroadcastGameSource } from './broadcast-game-store';
import { broadcastGames, broadcastTours } from './broadcast-schema';
import type { Executor } from './client';

/** A game a search found, from the searched player's side (R-185). */
export interface FoundGame extends PlayerGame {
  readonly url: string;
  readonly source: BroadcastGameSource;
  /** From a dump month or an official tournament. */
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

/** The official game a community game may copy, and its tournament. */
const copy = alias(broadcastGames, 'official_copy');
const copyTour = alias(broadcastTours, 'official_copy_tour');

/**
 * The games the player with `id` played in `scope`'s months and in the
 * tournaments whose last round is in its window, newest month first, then
 * newest date, undated last (R-185), with no community copy of an official
 * game the scope also covers (preferOfficialCopies): at most
 * FOUND_GAMES_LIMIT of them, and `truncated` when there were more.
 */
export async function gamesForFideId(
  db: Executor,
  id: FideId,
  scope: BroadcastSearchScope,
): Promise<FoundGames> {
  const sources = scopeCondition(scope, broadcastGames, broadcastTours);
  const officialCopies = scopeCondition(scope, copy, copyTour, true);
  if (sources === undefined || officialCopies === undefined) {
    return { games: [], truncated: false };
  }
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
          or(
            sql`${broadcastTours.official} is not false`,
            notExists(copiesOf(db, officialCopies)),
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

/**
 * The official games in scope (`official`) that the outer game is a copy
 * of: the same date and the same two FIDE IDs in the same colours, with
 * the same result. A null date or FIDE ID matches nothing, as in the
 * domain rule.
 */
function copiesOf(db: Executor, official: SQL) {
  return db
    .select({ one: sql`1` })
    .from(copy)
    .leftJoin(copyTour, eq(copyTour.tourId, copy.tourId))
    .where(
      and(
        eq(copy.date, broadcastGames.date),
        eq(copy.whiteFideId, broadcastGames.whiteFideId),
        eq(copy.blackFideId, broadcastGames.blackFideId),
        eq(copy.result, broadcastGames.result),
        official,
      ),
    );
}

/**
 * The games of `games` (joined to `tours`) that `scope` covers, only its
 * official ones when `officialOnly`; undefined when it covers none.
 */
function scopeCondition(
  scope: BroadcastSearchScope,
  games: { readonly month: PgColumn; readonly tourId: PgColumn },
  tours: { readonly lastRoundAt: PgColumn; readonly official: PgColumn },
  officialOnly = false,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (scope.months.length > 0) {
    conditions.push(inArray(games.month, [...scope.months]));
  }
  if (scope.window !== null) {
    const inWindow = and(
      isNotNull(games.tourId),
      gte(tours.lastRoundAt, broadcastWindowStart(scope.window)),
      officialOnly ? sql`${tours.official} is true` : undefined,
    );
    if (inWindow !== undefined) conditions.push(inWindow);
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
