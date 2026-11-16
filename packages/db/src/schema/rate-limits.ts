// Request counters: Better Auth's and our own.
import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Better Auth's request counters for `rateLimit: { storage: 'database' }`
 * (in-memory limits do nothing across serverless instances), one per key.
 */
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  /** Epoch milliseconds, as Better Auth stores it. */
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/**
 * Our own fixed-window request counters (rate-limits.ts), such as the PGN
 * import's (R-119) and the magic link's per email (#264), one per key. Not
 * Better Auth's table: Better Auth deletes its rows past its own longest
 * window (a minute) whenever one of its keys opens a new window, which
 * would end our longer windows early.
 */
export const requestCounters = pgTable('request_counters', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  /** Epoch milliseconds the current window opened. */
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
});
