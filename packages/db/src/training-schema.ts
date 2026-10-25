// S6's training tables (plan decisions 2-4): a player's Reviews (R-53: one
// per player and move key) and the log of every training result the browser
// sent. Both go with the account. drizzle-kit reads this file beside
// schema.ts (drizzle.config.ts).
import { RESULT_KINDS } from '@mychess/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './schema';
import { at, between, oneOf } from './schema-columns';

/**
 * One Review: its FSRS card as columns (`due` indexed), the R-56 lapse
 * history, and how the move entered training: a learn pass (`learned_at`)
 * or "I know this" (`skipped_at`), exactly one of the two.
 */
export const reviews = pgTable(
  'reviews',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    due: at('due').notNull(),
    stability: doublePrecision('stability').notNull(),
    difficulty: doublePrecision('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    /** ts-fsrs State: New 0, Learning 1, Review 2, Relearning 3. */
    state: smallint('state').notNull(),
    lastReview: at('last_review'),
    lapseTimes: at('lapse_times')
      .array()
      .notNull()
      .default(sql`'{}'`),
    learnedAt: at('learned_at'),
    skippedAt: at('skipped_at'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.moveKey] }),
    index('reviews_player_due_idx').on(t.playerId, t.due),
    check(
      'reviews_entered_once',
      sql`(${t.learnedAt} is null) <> (${t.skippedAt} is null)`,
    ),
    check('reviews_state_check', between(t.state, 0, 3)),
  ],
);

/**
 * Every result the browser sent, applied or not (plan decisions 3-4): the
 * primary key makes a resent result a duplicate. `repertoire_id` has no
 * foreign key on purpose: the log is the player's history and outlives a
 * deleted repertoire.
 */
export const reviewResults = pgTable(
  'review_results',
  {
    resultId: uuid('result_id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    repertoireId: uuid('repertoire_id').notNull(),
    kind: text('kind', { enum: RESULT_KINDS }).notNull(),
    answeredAt: at('answered_at').notNull(),
    applied: boolean('applied').notNull(),
    receivedAt: at('received_at').notNull(),
  },
  (t) => [
    index('review_results_player_idx').on(t.playerId, t.answeredAt),
    check('review_results_kind_check', oneOf(t.kind, RESULT_KINDS)),
  ],
);
