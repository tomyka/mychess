// Accounts and sign-in. Better Auth's tables carry our names (apps/web
// src/server/auth/options.ts maps them): its "user" is our Account and its "account"
// is a provider link.
import { DEFAULT_ENTITLEMENT, ENTITLEMENTS } from '@mychess/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { at, between, oneOf } from '../schema-columns';

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    /** The canonical email (domain canonicalEmail); one account each. */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name').notNull(),
    image: text('image'),
    entitlement: text('entitlement', { enum: ENTITLEMENTS })
      .notNull()
      .default(DEFAULT_ENTITLEMENT),
    admin: boolean('admin').notNull().default(false),
    disabledAt: at('disabled_at'),
    onboardedAt: at('onboarded_at'),
    /** When Coach mode was switched on (R-11); null while it is off. */
    coachSince: at('coach_since'),
    /**
     * R-62, R-146, R-205: Reviews per session (10-100), new moves a day
     * (0-50), arrows when learning new moves.
     */
    sessionSize: integer('session_size').notNull().default(20),
    newPerDay: integer('new_per_day').notNull().default(10),
    learnArrows: boolean('learn_arrows').notNull().default(true),
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
    check('accounts_entitlement_check', oneOf(t.entitlement, ENTITLEMENTS)),
    check('accounts_session_size_check', between(t.sessionSize, 10, 100)),
    check('accounts_new_per_day_check', between(t.newPerDay, 0, 50)),
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
