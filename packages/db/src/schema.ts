// The database schema: every table, as drizzle-kit reads it to generate
// migrations (drizzle.config.ts). Better Auth's five tables carry our names
// (src/server/auth.ts in apps/web maps them): its "user" is our Account and
// its "account" is a provider link.
import {
  ADMIN_ACTIONS,
  DEFAULT_ENTITLEMENT,
  DEFAULT_LOCALE,
  ENTITLEMENTS,
  LOCALES,
} from '@mychess/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
 * key: the row outlives the account it is about.
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: serial('id').primaryKey(),
    action: text('action', { enum: ADMIN_ACTIONS }).notNull(),
    targetAccountId: text('target_account_id').notNull(),
    targetEmail: text('target_email').notNull(),
    actor: text('actor').notNull(),
    at: at('at').notNull(),
  },
  (t) => [check('admin_audit_action_check', oneOf(t.action, ADMIN_ACTIONS))],
);
