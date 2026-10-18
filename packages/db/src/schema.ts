// The database schema: every table, as drizzle-kit reads it to generate
// migrations (drizzle.config.ts). Better Auth's five tables carry our names
// (src/server/auth.ts in apps/web maps them): its "user" is our Account and
// its "account" is a provider link.
import {
  ADMIN_ACTIONS,
  DEFAULT_ENTITLEMENT,
  DEFAULT_LOCALE,
  ENTITLEMENTS,
  GROUP_NAME_MAX,
  INVITE_KINDS,
  LOCALES,
} from '@mychess/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * `column in ('a', 'b')` with the values inlined, for a CHECK constraint
 * built from the same list as the column's enum, so the two cannot drift.
 * The values are our own constants, never input.
 */
const oneOf = (column: PgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    /** The canonical email (domain canonicalEmail); one account each. */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name').notNull(),
    image: text('image'),
    locale: text('locale', { enum: LOCALES }).notNull().default(DEFAULT_LOCALE),
    entitlement: text('entitlement', { enum: ENTITLEMENTS })
      .notNull()
      .default(DEFAULT_ENTITLEMENT),
    admin: boolean('admin').notNull().default(false),
    disabledAt: at('disabled_at'),
    onboardedAt: at('onboarded_at'),
    /** When Coach mode was switched on (R-11); null while it is off. */
    coachSince: at('coach_since'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    // A backstop for canonicalEmail: already NFKC-folded, trimmed and lower
    // case, and printable ASCII only, so no lookalike letter gets through.
    check(
      'accounts_email_canonical',
      sql`${t.email} = lower(btrim(normalize(${t.email}, NFKC))) and ${t.email} ~ '^[\\x21-\\x7e]+$'`,
    ),
    check('accounts_locale_check', oneOf(t.locale, LOCALES)),
    check('accounts_entitlement_check', oneOf(t.entitlement, ENTITLEMENTS)),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: at('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [index('sessions_account_id_idx').on(t.accountId)],
);

export const providerAccounts = pgTable(
  'provider_accounts',
  {
    id: text('id').primaryKey(),
    /** The provider's id for the person (Google sub, Lichess username id). */
    providerAccountId: text('provider_account_id').notNull(),
    providerId: text('provider_id').notNull(),
    ownerAccountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: at('access_token_expires_at'),
    refreshTokenExpiresAt: at('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('provider_accounts_provider_idx').on(
      t.providerId,
      t.providerAccountId,
    ),
    index('provider_accounts_account_id_idx').on(t.ownerAccountId),
  ],
);

/** Magic-link tokens and OAuth state; short-lived, keyed by `identifier`. */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

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
 * Append-only record of every Admin action (security item 8). No foreign
 * key: the row outlives the account it is about. It names the target by id
 * and by a one-way hash of its email, never the address (R-88).
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: serial('id').primaryKey(),
    action: text('action', { enum: ADMIN_ACTIONS }).notNull(),
    targetAccountId: text('target_account_id').notNull(),
    /** auditEmailHash (keyed, R-94) of the target's canonical email. */
    targetEmailHash: text('target_email_hash').notNull(),
    actor: text('actor').notNull(),
    at: at('at').notNull(),
  },
  (t) => [
    check('admin_audit_action_check', oneOf(t.action, ADMIN_ACTIONS)),
    // A backstop for auditEmailHash: a hex HMAC-SHA-256, so no address fits.
    check(
      'admin_audit_target_email_hash_check',
      sql`${t.targetEmailHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

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
