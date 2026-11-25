import 'server-only';
import { authSchema, findAccountById, type Db } from '@mychess/db';
import {
  canOpenSession,
  DEFAULT_ENTITLEMENT,
  FRESH_AGE_SECONDS,
  GOOGLE,
  LICHESS,
  MAGIC_LINK_RATE_LIMIT,
  signInEmail,
} from '@mychess/domain';
import {
  betterAuth,
  type Auth as BetterAuth,
  type BetterAuthOptions,
} from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { ROUTES } from '../../lib/routes';
import { refusalError } from '../auth-refusal';
import { googleConfigured, type WebEnv } from '../env';
import { magicLinkMail, type Mailer } from '../mail';
import { noteLichessUnlinked } from '../lichess-unlinked';
import { lichessUserInfo } from '../oauth/lichess';
import { endUnlinkedProviderSession } from '../provider-session';
import { testSignInPlugin } from '../test-sign-in';
import { provingGoogleUserInfo, validateUserInfo } from './provider-join';
import { beforeRequest } from './request-hooks';

const DAY = 60 * 60 * 24;

export interface AuthDeps {
  readonly db: Db;
  readonly env: WebEnv;
  readonly mail: Mailer;
  /** The fetch Lichess identity calls use; feature tests pass a fake. */
  readonly fetch?: typeof fetch;
}

type UserOptions = NonNullable<BetterAuthOptions['user']>;
type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;

/**
 * A disabled account opens no session (security item 8). An account our
 * connection cannot see yet is one Better Auth is creating in this request;
 * the sessions table's foreign key still demands it exists.
 */
async function mayOpenSession(db: Db, accountId: string): Promise<boolean> {
  const account = await findAccountById(db, accountId);
  return account === undefined || canOpenSession(account).ok;
}

/** The email a new account is keyed by, or the request's refusal (item 6). */
function newAccountEmail(raw: unknown): string {
  const email = signInEmail(raw);
  if (!email.ok) throw refusalError(email.refusal);
  return email.value;
}

function databaseHooks(db: Db): DatabaseHooks {
  return {
    user: {
      create: {
        // Canonical email (security item 6).
        before: (account) =>
          Promise.resolve({
            data: {
              ...account,
              email: newAccountEmail(account.email),
            },
          }),
      },
    },
    session: {
      create: {
        before: (session) => mayOpenSession(db, session.userId),
        after: endUnlinkedProviderSession,
      },
    },
    account: { delete: { before: noteLichessUnlinked } },
  };
}

// Our fields are never client input: no request can set them (decision 8).
const accountFields = {
  entitlement: {
    type: 'string',
    defaultValue: DEFAULT_ENTITLEMENT,
    input: false,
  },
  admin: {
    type: 'boolean',
    defaultValue: false,
    input: false,
    returned: false,
  },
  disabledAt: { type: 'date', required: false, input: false },
  onboardedAt: { type: 'date', required: false, input: false },
} as const;

function userOptions(db: Db) {
  return {
    modelName: 'accounts',
    fields: { name: 'displayName' },
    additionalFields: accountFields,
    validateUserInfo: validateUserInfo(db),
  } satisfies UserOptions;
}

const sessionOptions = {
  modelName: 'sessions',
  fields: { userId: 'accountId' },
  expiresIn: 90 * DAY,
  updateAge: DAY,
  // Unlinking checks it; linking (refuseStaleLink) and the export check
  // the same age through isFreshSession (R-84, R-95).
  freshAge: FRESH_AGE_SECONDS,
} satisfies BetterAuthOptions['session'];

const providerAccountOptions = {
  modelName: 'providerAccounts',
  // The owner is not `accountId`: Better Auth resolves a mapped field name
  // that is also one of its own field names to its own field, so a link's
  // owner would be read as the provider's id and every returning OAuth
  // sign-in would find the link orphaned.
  fields: { userId: 'ownerAccountId', accountId: 'providerAccountId' },
  encryptOAuthTokens: true,
  accountLinking: {
    enabled: true,
    trustedProviders: [LICHESS],
    allowDifferentEmails: true,
    allowUnlinkingAll: true,
  },
} satisfies BetterAuthOptions['account'];

// Profile changes, deletion and email changes go through our own server
// actions so the domain rules apply; there are no passwords, a magic link
// proves the email, and provider tokens never leave the server (decision 8).
const DISABLED_PATHS = [
  '/update-user',
  '/delete-user',
  '/delete-user/callback',
  '/change-email',
  '/sign-up/email',
  '/sign-in/email',
  '/verify-email',
  '/send-verification-email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password',
  '/update-session',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
];

function magicLinkPlugin(mail: Mailer) {
  return magicLink({
    expiresIn: 15 * 60,
    storeToken: 'hashed',
    sendMagicLink: async ({ email, url }) => {
      await mail.send(magicLinkMail(email, url));
    },
  });
}

function lichessPlugin(env: WebEnv, fetchImpl: typeof fetch) {
  return genericOAuth({
    config: [
      {
        providerId: LICHESS,
        clientId: env.LICHESS_CLIENT_ID,
        authorizationUrl: 'https://lichess.org/oauth',
        tokenUrl: 'https://lichess.org/api/token',
        scopes: ['email:read'],
        pkce: true,
        getUserInfo: lichessUserInfo(fetchImpl),
      },
    ],
  });
}

/**
 * Google, when both its credentials are set: an empty pair leaves the
 * provider out, so a Google sign-in is refused as unknown rather than
 * failing (security A7). Production requires both (env.ts).
 */
function socialProviders(env: WebEnv, db: Db) {
  if (!googleConfigured(env)) return {};
  return {
    [GOOGLE]: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      getUserInfo: provingGoogleUserInfo(db),
      disableIdTokenSignIn: true,
    },
  };
}

/**
 * Request limits per client address and path, counted in the database:
 * in-memory counters do nothing across serverless instances (security A6).
 * Always on: Better Auth's default turns them off outside NODE_ENV
 * production. A magic link is mailed at most three times a minute per
 * address; Better Auth's own rules cover the other sign-in paths. The
 * per-email magic-link limit is ours (countedMagicLinkBody, #264).
 */
const rateLimitOptions = {
  enabled: true,
  storage: 'database',
  modelName: 'rateLimits',
  customRules: {
    '/sign-in/magic-link': {
      window: MAGIC_LINK_RATE_LIMIT.windowMs / 1000,
      max: MAGIC_LINK_RATE_LIMIT.max,
    },
  },
} satisfies BetterAuthOptions['rateLimit'];

/**
 * The client address as Caddy forwards it in production: Caddy sets
 * X-Real-IP from the connection and replaces any X-Forwarded-For the client
 * sent (infra/edge/caddy/Caddyfile).
 *
 * The origin and callback-URL checks are on everywhere. Better Auth turns
 * them off by default when NODE_ENV is "test", which would let the feature
 * suite pass a foreign `callbackURL` that production refuses (R-81).
 */
const advancedOptions = {
  ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
  disableOriginCheck: false,
} satisfies BetterAuthOptions['advanced'];

function authOptions({ db, env, mail, fetch: fetchImpl = fetch }: AuthDeps) {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    disabledPaths: DISABLED_PATHS,
    user: userOptions(db),
    session: sessionOptions,
    account: providerAccountOptions,
    verification: { modelName: 'verifications' },
    socialProviders: socialProviders(env, db),
    rateLimit: rateLimitOptions,
    advanced: advancedOptions,
    // An error with no errorCallbackURL of its own lands on our sign-in
    // page, which translates its code, not on Better Auth's /error page.
    onAPIError: { errorURL: new URL(ROUTES.signIn, env.BETTER_AUTH_URL).href },
    hooks: { before: createAuthMiddleware(beforeRequest(db)) },
    databaseHooks: databaseHooks(db),
    plugins: [
      magicLinkPlugin(mail),
      lichessPlugin(env, fetchImpl),
      testSignInPlugin(env),
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

export type Auth = BetterAuth<ReturnType<typeof authOptions>>;

/** Better Auth on `deps` (ADR 0010); feature tests build it on a test database. */
export function createAuth(deps: AuthDeps): Auth {
  return betterAuth(authOptions(deps));
}
