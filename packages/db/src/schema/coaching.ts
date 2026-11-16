// Coaching: groups, Coach links, group membership and invites.
import { GROUP_NAME_MAX, INVITE_KINDS } from '@mychess/domain';
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
import { at, oneOf } from '../schema-columns';
import { accounts } from './accounts';

/** A Coach's named set of linked players (R-12). */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    // The target of the (group, coach) foreign keys below.
    unique('groups_id_coach_unique').on(t.id, t.coachId),
    index('groups_coach_id_idx').on(t.coachId),
    // A backstop for groupNameSchema.
    check(
      'groups_name_check',
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and ${sql.raw(String(GROUP_NAME_MAX))}`,
    ),
  ],
);

/** An accepted Coach link (R-12, R-13): the only source of coach access. */
export const coachLinks = pgTable(
  'coach_links',
  {
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'coach_links_pk', columns: [t.coachId, t.playerId] }),
    index('coach_links_player_id_idx').on(t.playerId),
    check('coach_links_not_self', sql`${t.coachId} <> ${t.playerId}`),
  ],
);

/**
 * A player in a coach's group. Both foreign keys cascade: deleting the
 * group or ending the Coach link (unlink) removes the membership in the
 * same statement, so a member is always linked (plan decision 2).
 */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id').notNull(),
    coachId: text('coach_id').notNull(),
    playerId: text('player_id').notNull(),
    /** S5 needs it: a group deadline is never before the join date (R-16). */
    joinedAt: at('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'group_members_pk', columns: [t.groupId, t.playerId] }),
    foreignKey({
      name: 'group_members_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'group_members_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    index('group_members_link_idx').on(t.coachId, t.playerId),
  ],
);

/**
 * A coach's invite (R-98, R-99, R-110). Only the SHA-256 of its token is
 * stored; the raw token is shown once, when the invite is made (checklist 5).
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INVITE_KINDS }).notNull(),
    groupId: uuid('group_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: at('expires_at').notNull(),
    revokedAt: at('revoked_at'),
    usedAt: at('used_at'),
    usedBy: text('used_by').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    check('invites_kind_check', oneOf(t.kind, INVITE_KINDS)),
    check(
      'invites_group_kind',
      sql`${t.kind} <> 'group' or ${t.groupId} is not null`,
    ),
    check(
      'invites_used_personal',
      sql`${t.usedAt} is null or ${t.kind} = 'personal'`,
    ),
    check('invites_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    // Null group: not checked (MATCH SIMPLE). Otherwise the coach's own group.
    foreignKey({
      name: 'invites_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    index('invites_coach_id_idx').on(t.coachId),
    // Deleting an account sets its used_by to null (ON DELETE SET NULL).
    index('invites_used_by_idx').on(t.usedBy),
  ],
);
