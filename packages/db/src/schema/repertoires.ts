// Repertoires: the position-keyed graph, its chapters and the player's notes.
import type { Arrow, ChapterNameSource, Circle } from '@mychess/chess';
import { SIDES } from '@mychess/chess';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { at, oneOf } from '../schema-columns';
import { accounts } from './accounts';

/** A Player's (later also a Coach's) repertoire for one side (R-19). */
export const repertoires = pgTable(
  'repertoires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerAccountId: text('owner_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    side: text('side', { enum: SIDES }).notNull(),
    name: text('name').notNull(),
    /** Bumped by every graph edit; a save names the version it started from. */
    version: integer('version').notNull().default(1),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    index('repertoires_owner_idx').on(t.ownerAccountId),
    check('repertoires_side_check', oneOf(t.side, SIDES)),
    // The target of repertoire_shares_owner_fk.
    unique('repertoires_id_owner_unique').on(t.id, t.ownerAccountId),
  ],
);

/** A repertoire's chapters; `chapter_id` is the graph's id, unique per repertoire. */
export const chapters = pgTable(
  'chapters',
  {
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').notNull(),
    rootKey: text('root_key').notNull(),
    nameSource: jsonb('name_source').$type<ChapterNameSource>().notNull(),
    intro: text('intro'),
    /** The chapter's place in the repertoire's chapter list. */
    ord: integer('ord').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repertoireId, t.chapterId] })],
);

/**
 * One move of a repertoire's position-keyed graph (Q27): stored once per
 * position and SAN, so S5 assignments and S6 training state can point at it.
 * `ord` is insertion order, which makes the main line (R-79).
 */
export const repertoireMoves = pgTable(
  'repertoire_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    fromKey: text('from_key').notNull(),
    san: text('san').notNull(),
    toKey: text('to_key').notNull(),
    uci: text('uci').notNull(),
    arrows: jsonb('arrows').$type<readonly Arrow[]>().notNull().default([]),
    circles: jsonb('circles').$type<readonly Circle[]>().notNull().default([]),
    comment: text('comment'),
    /** The move's NAGs (R-175), `$1` to `$255`, in file order. */
    nags: integer('nags').array().notNull().default([]),
    ord: integer('ord').notNull(),
  },
  (t) => [
    uniqueIndex('repertoire_moves_position_idx').on(
      t.repertoireId,
      t.fromKey,
      t.san,
    ),
    // The target of move_chapters_move_fk.
    unique('repertoire_moves_id_repertoire_unique').on(t.id, t.repertoireId),
  ],
);

/**
 * Which chapters hold a move (a move may be in several). Both foreign keys
 * carry `repertoire_id`, so a link's move and chapter are of one repertoire.
 */
export const moveChapters = pgTable(
  'move_chapters',
  {
    moveId: uuid('move_id').notNull(),
    repertoireId: uuid('repertoire_id').notNull(),
    chapterId: text('chapter_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.moveId, t.chapterId] }),
    foreignKey({
      name: 'move_chapters_move_fk',
      columns: [t.moveId, t.repertoireId],
      foreignColumns: [repertoireMoves.id, repertoireMoves.repertoireId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'move_chapters_chapter_fk',
      columns: [t.repertoireId, t.chapterId],
      foreignColumns: [chapters.repertoireId, chapters.chapterId],
    }).onDelete('cascade'),
    index('move_chapters_repertoire_idx').on(t.repertoireId),
  ],
);

/** A Player's private note on a move (R-21); keyed by move key (decision 11). */
export const personalNotes = pgTable(
  'personal_notes',
  {
    playerAccountId: text('player_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playerAccountId, t.repertoireId, t.moveKey] }),
    // The primary key leads with the player; a repertoire delete cascades by this.
    index('personal_notes_repertoire_idx').on(t.repertoireId),
  ],
);
