// The FIDE ID search's index of the Lichess broadcast dumps (#316, spec
// decision 1): a row per dump month and its processing state, and a row per
// broadcast game with at least one FIDE ID. Public broadcast data only; no
// account owns it, so it is in no account's export (spec decision 7).
// drizzle-kit reads this file beside schema.ts (drizzle.config.ts).
import {
  BROADCAST_RESULTS,
  LICHESS_GAME_URL,
  BROADCAST_MONTH_PATTERN,
  BROADCAST_MONTH_STATES,
} from '@mychess/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { at, matches, oneOf } from './schema-columns';

/**
 * A dump month's index state (spec decision 2). Each state but pending
 * keeps when it was entered: claimed_at, processed_at or failed_at. A
 * pending month keeps in failed_at when its last attempt failed, null
 * before any did, for the 10-minute pause of R-188.
 */
export const broadcastMonths = pgTable(
  'broadcast_months',
  {
    month: text('month').primaryKey(),
    state: text('state', { enum: BROADCAST_MONTH_STATES }).notNull(),
    attempts: integer('attempts').notNull(),
    /**
     * The games of the dump that passed broadcastGameSchema when the month
     * was written, those already stored under another month included.
     */
    gameCount: integer('game_count'),
    claimedAt: at('claimed_at'),
    failedAt: at('failed_at'),
    processedAt: at('processed_at'),
  },
  (t) => [
    check(
      'broadcast_months_month_check',
      matches(t.month, BROADCAST_MONTH_PATTERN),
    ),
    check(
      'broadcast_months_state_check',
      oneOf(t.state, BROADCAST_MONTH_STATES),
    ),
    check('broadcast_months_attempts_check', sql`${t.attempts} >= 0`),
    check(
      'broadcast_months_claimed_check',
      sql`${t.state} <> 'processing' or ${t.claimedAt} is not null`,
    ),
    check(
      'broadcast_months_done_check',
      sql`${t.state} <> 'done' or (${t.processedAt} is not null and ${t.gameCount} is not null)`,
    ),
    check(
      'broadcast_months_failed_check',
      sql`${t.state} <> 'failed' or ${t.failedAt} is not null`,
    ),
  ],
);

/**
 * A broadcast game a FIDE ID search can find: who played it, when, how it
 * ended and its opening, but not its moves. Its URL is the Lichess game it
 * links to and keeps it once, whichever month listed it first.
 */
export const broadcastGames = pgTable(
  'broadcast_games',
  {
    gameUrl: text('game_url').primaryKey(),
    month: text('month')
      .notNull()
      .references(() => broadcastMonths.month, { onDelete: 'cascade' }),
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
    index('broadcast_games_white_fide_id_idx').on(t.whiteFideId),
    index('broadcast_games_black_fide_id_idx').on(t.blackFideId),
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
