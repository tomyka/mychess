// S5's assignment tables (plan decisions 1-7): assignments, the players'
// own state on them, the per-edit changes, fork offers and the coach notes
// kept in forks. drizzle-kit reads this file beside schema.ts
// (drizzle.config.ts).
import { FORK_OFFER_REASONS } from '@mychess/domain';
import { SIDES } from '@mychess/chess';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, coachLinks, groups, repertoires } from './schema';
import { at, oneOf } from './schema-columns';

/**
 * A coach's Assignment of their own repertoire to one linked player or one
 * of their groups (R-15, R-16; plan decision 1). Every foreign key cascades,
 * so unlinking, deleting the group or deleting the repertoire ends it in the
 * same statement; changeAssignments writes the fork offers first.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id').notNull(),
    repertoireId: uuid('repertoire_id').notNull(),
    playerId: text('player_id'),
    groupId: uuid('group_id'),
    /** A calendar date (plan decision 10); null for none. */
    deadline: date('deadline', { mode: 'string' }),
    /** The repertoire's version when assigned (plan decision 2). */
    assignedVersion: integer('assigned_version').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    check(
      'assignments_one_target',
      sql`(${t.playerId} is null) <> (${t.groupId} is null)`,
    ),
    // The coach's own repertoire (lead decision 5).
    foreignKey({
      name: 'assignments_repertoire_fk',
      columns: [t.repertoireId, t.coachId],
      foreignColumns: [repertoires.id, repertoires.ownerAccountId],
    }).onDelete('cascade'),
    // MATCH SIMPLE: checked only for a player target.
    foreignKey({
      name: 'assignments_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    // MATCH SIMPLE: checked only for a group target.
    foreignKey({
      name: 'assignments_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    // At most once per target (lead decision 5).
    uniqueIndex('assignments_player_unique')
      .on(t.repertoireId, t.playerId)
      .where(sql`${t.playerId} is not null`),
    uniqueIndex('assignments_group_unique')
      .on(t.repertoireId, t.groupId)
      .where(sql`${t.groupId} is not null`),
    // The partial indexes above do not serve the cascades; these do.
    index('assignments_repertoire_idx').on(t.repertoireId, t.coachId),
    index('assignments_link_idx').on(t.coachId, t.playerId),
    index('assignments_group_idx').on(t.groupId),
  ],
);

/** A player's own state on a repertoire they have by assignment (plan decision 4). */
export const assignmentPlayers = pgTable(
  'assignment_players',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    /** R-46. */
    pausedAt: at('paused_at'),
    /** The version the player last opened (R-133). */
    seenVersion: integer('seen_version'),
    /** R-128: the player forked it; the coach sees "forked". */
    forkedAt: at('forked_at'),
  },
  (t) => [
    primaryKey({
      name: 'assignment_players_pk',
      columns: [t.playerId, t.repertoireId],
    }),
    index('assignment_players_repertoire_idx').on(t.repertoireId),
  ],
);

/**
 * What one graph edit changed for players (R-133; plan decision 3): chess's
 * MoveChanges as JSON, untyped here so every reader parses it with chess's
 * moveChangesSchema.
 */
export const repertoireChanges = pgTable(
  'repertoire_changes',
  {
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    changes: jsonb('changes').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'repertoire_changes_pk',
      columns: [t.repertoireId, t.version],
    }),
  ],
);

/**
 * A 30-day offer to keep a copy of an Assignment that ended (R-44, R-45,
 * R-130, R-131). The snapshot is taken when it ends (lead decision 3), so
 * it outlives the repertoire and the coach; it is parsed whenever it is read.
 */
export const forkOffers = pgTable(
  'fork_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Null once the source repertoire is deleted (R-131). */
    repertoireId: uuid('repertoire_id').references(() => repertoires.id, {
      onDelete: 'set null',
    }),
    coachName: text('coach_name').notNull(),
    name: text('name').notNull(),
    side: text('side', { enum: SIDES }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    reason: text('reason', { enum: FORK_OFFER_REASONS }).notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    acceptedAt: at('accepted_at'),
    declinedAt: at('declined_at'),
    /** Set when the player was assigned the repertoire again (lead decision 4). */
    closedAt: at('closed_at'),
    /** The fork an accepted offer made; null once that fork is deleted. */
    forkId: uuid('fork_id').references(() => repertoires.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check('fork_offers_reason_check', oneOf(t.reason, FORK_OFFER_REASONS)),
    check('fork_offers_side_check', oneOf(t.side, SIDES)),
    index('fork_offers_player_idx').on(t.playerId),
    index('fork_offers_repertoire_idx').on(t.repertoireId),
    index('fork_offers_fork_idx').on(t.forkId),
  ],
);

/** A coach's comments kept read-only in a player's fork (R-47, R-49; plan decision 7). */
export const forkCoachNotes = pgTable(
  'fork_coach_notes',
  {
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    coachName: text('coach_name').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'fork_coach_notes_pk',
      columns: [t.repertoireId, t.moveKey],
    }),
  ],
);
