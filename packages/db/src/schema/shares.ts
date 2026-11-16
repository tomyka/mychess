// A player's repertoire shared with a linked coach, and the coach's notes on it.
import { COACH_NOTE_MAX } from '@mychess/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { at } from '../schema-columns';
import { coachLinks } from './coaching';
import { repertoires } from './repertoires';

/**
 * A Player's own repertoire shared with one linked coach (R-42). Both
 * foreign keys cascade: the owner one makes the player the repertoire's
 * owner and goes with the repertoire; the link one means a share exists
 * only through an active Coach link, so unlinking ends every share of that
 * pair in the same statement (plan decision 2).
 */
export const repertoireShares = pgTable(
  'repertoire_shares',
  {
    repertoireId: uuid('repertoire_id').notNull(),
    playerId: text('player_id').notNull(),
    coachId: text('coach_id').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'repertoire_shares_pk',
      columns: [t.repertoireId, t.coachId],
    }),
    foreignKey({
      name: 'repertoire_shares_owner_fk',
      columns: [t.repertoireId, t.playerId],
      foreignColumns: [repertoires.id, repertoires.ownerAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'repertoire_shares_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    index('repertoire_shares_link_idx').on(t.coachId, t.playerId),
  ],
);

/**
 * A coach's note on a move of a repertoire shared with them (R-42), keyed
 * by move key like a personal note. It exists only under its share: the
 * share foreign key cascades, so unsharing, unlinking (through the share),
 * deleting the repertoire or either account deletes it (R-124).
 */
export const coachNotes = pgTable(
  'coach_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id').notNull(),
    repertoireId: uuid('repertoire_id').notNull(),
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    unique('coach_notes_coach_move_unique').on(
      t.coachId,
      t.repertoireId,
      t.moveKey,
    ),
    foreignKey({
      name: 'coach_notes_share_fk',
      columns: [t.repertoireId, t.coachId],
      foreignColumns: [repertoireShares.repertoireId, repertoireShares.coachId],
    }).onDelete('cascade'),
    // Leads with the share's first column, so a share's cascade finds its notes.
    index('coach_notes_repertoire_idx').on(t.repertoireId),
    // A backstop for coachNoteSchema.
    check(
      'coach_notes_text_check',
      sql`${t.text} = btrim(${t.text}) and char_length(${t.text}) between 1 and ${sql.raw(String(COACH_NOTE_MAX))}`,
    ),
  ],
);
