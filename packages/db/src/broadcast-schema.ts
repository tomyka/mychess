// The FIDE ID search's index of Lichess broadcasts (#316, #349): a row per
// dump month and per broadcast tournament with its processing state, and a
// row per broadcast game with at least one FIDE ID, from one month or one
// tournament. Public broadcast data only; no account owns it, so it is in
// no account's export (#316 spec decision 7).
// drizzle-kit reads this file beside schema/ (drizzle.config.ts).
import {
  BROADCAST_MONTH_PATTERN,
  BROADCAST_MONTH_STATES,
  BROADCAST_RESULTS,
  BROADCAST_TEXT_MAX,
  BROADCAST_TOUR_ID_PATTERN,
  LICHESS_GAME_URL,
} from '@mychess/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import { at, matches, oneOf } from './schema-columns';

/**
 * The processing state a month and a tournament share (#316 spec decision
 * 2). Each state but pending keeps when it was entered: claimed_at,
 * processed_at or failed_at. A pending entry keeps in failed_at when its
 * last attempt failed, null before any did, for the 10-minute pause of
 * R-188.
 */
const indexStateColumns = () => ({
  state: text('state', { enum: BROADCAST_MONTH_STATES }).notNull(),
  attempts: integer('attempts').notNull(),
  /**
   * The games that passed broadcastGameSchema when the entry was written,
   * those already stored under another month or tournament included.
   */
  gameCount: integer('game_count'),
  claimedAt: at('claimed_at'),
  failedAt: at('failed_at'),
  processedAt: at('processed_at'),
});

interface IndexStateTable {
  readonly state: PgColumn;
  readonly attempts: PgColumn;
  readonly gameCount: PgColumn;
  readonly claimedAt: PgColumn;
  readonly failedAt: PgColumn;
  readonly processedAt: PgColumn;
}

/** The checks of the processing state, named after `table`. */
const indexStateChecks = (table: string, t: IndexStateTable) => [
  check(`${table}_state_check`, oneOf(t.state, BROADCAST_MONTH_STATES)),
  check(`${table}_attempts_check`, sql`${t.attempts} >= 0`),
  check(
    `${table}_claimed_check`,
    sql`${t.state} <> 'processing' or ${t.claimedAt} is not null`,
  ),
  check(
    `${table}_done_check`,
    sql`${t.state} <> 'done' or (${t.processedAt} is not null and ${t.gameCount} is not null)`,
  ),
  check(
    `${table}_failed_check`,
    sql`${t.state} <> 'failed' or ${t.failedAt} is not null`,
  ),
];

/** A dump month's index state (#316 spec decision 2). */
export const broadcastMonths = pgTable(
  'broadcast_months',
  {
    month: text('month').primaryKey(),
    ...indexStateColumns(),
  },
  (t) => [
    check(
      'broadcast_months_month_check',
      matches(t.month, BROADCAST_MONTH_PATTERN),
    ),
    ...indexStateChecks('broadcast_months', t),
  ],
);

/**
 * A Lichess account name as an organiser is stored: lower case, as
 * approvedOrganiser gives it. Not the approved list itself, which changes
 * by a reviewed code change without a migration (R-200).
 */
const ORGANISER_PATTERN = '^[a-z0-9_-]{2,30}$';

/**
 * A Lichess broadcast tournament the index fetches once, when finished
 * (#349, spec decision 1), from an approved organiser's list: the only way
 * in since pasting a link was removed (R-201). Its last round decides
 * whether a search covers it (spec decision 2).
 */
export const broadcastTours = pgTable(
  'broadcast_tours',
  {
    tourId: text('tour_id').primaryKey(),
    name: text('name').notNull(),
    /** The approved organiser whose list it came from. */
    organiser: text('organiser').notNull(),
    official: boolean('official').notNull(),
    lastRoundAt: at('last_round_at').notNull(),
    ...indexStateColumns(),
  },
  (t) => [
    index('broadcast_tours_last_round_at_idx').on(t.lastRoundAt),
    check(
      'broadcast_tours_tour_id_check',
      matches(t.tourId, BROADCAST_TOUR_ID_PATTERN),
    ),
    check(
      'broadcast_tours_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(BROADCAST_TEXT_MAX))}`,
    ),
    check(
      'broadcast_tours_organiser_check',
      matches(t.organiser, ORGANISER_PATTERN),
    ),
    ...indexStateChecks('broadcast_tours', t),
  ],
);

/**
 * A broadcast game a FIDE ID search can find: who played it, when, how it
 * ended and its opening, but not its moves. Its URL is the Lichess game it
 * links to and keeps it once, whichever month or tournament listed it
 * first; it belongs to exactly that one.
 */
export const broadcastGames = pgTable(
  'broadcast_games',
  {
    gameUrl: text('game_url').primaryKey(),
    month: text('month').references(() => broadcastMonths.month, {
      onDelete: 'cascade',
    }),
    tourId: text('tour_id').references(() => broadcastTours.tourId, {
      onDelete: 'cascade',
    }),
    whiteFideId: integer('white_fide_id'),
    blackFideId: integer('black_fide_id'),
    white: text('white').notNull(),
    black: text('black').notNull(),
    date: date('date', { mode: 'string' }),
    result: text('result', { enum: BROADCAST_RESULTS }).notNull(),
    eco: text('eco'),
    opening: text('opening'),
    event: text('event').notNull(),
  },
  (t) => [
    index('broadcast_games_month_idx').on(t.month),
    index('broadcast_games_tour_id_idx').on(t.tourId),
    index('broadcast_games_white_fide_id_idx').on(t.whiteFideId),
    index('broadcast_games_black_fide_id_idx').on(t.blackFideId),
    check(
      'broadcast_games_source_check',
      sql`num_nonnulls(${t.month}, ${t.tourId}) = 1`,
    ),
    check(
      'broadcast_games_fide_id_check',
      sql`num_nonnulls(${t.whiteFideId}, ${t.blackFideId}) > 0 and coalesce(${t.whiteFideId}, 1) > 0 and coalesce(${t.blackFideId}, 1) > 0`,
    ),
    check(
      'broadcast_games_sides_check',
      sql`${t.whiteFideId} <> ${t.blackFideId}`,
    ),
    check('broadcast_games_result_check', oneOf(t.result, BROADCAST_RESULTS)),
    check('broadcast_games_url_check', matches(t.gameUrl, LICHESS_GAME_URL)),
  ],
);
