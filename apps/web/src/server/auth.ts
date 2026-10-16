import { authSchema, findAccountById, type Db } from '@mychess/db';
import {
  canonicalEmail,
  DEFAULT_ENTITLEMENT,
  DEFAULT_LOCALE,
  LOCALES,
} from '@mychess/domain';
import {
  betterAuth,
  type Auth as BetterAuth,
  type BetterAuthOptions,
} from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getOAuthState,
} from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { z } from 'zod';
import { resolveLocale } from '../i18n/locales';
import { getDb } from './db';
import { readWebEnv, type WebEnv } from './env';
import { createMailer, magicLinkMail, type Mailer } from './mail';
import { googleUserInfo } from './oauth/google';
import { lichessUserInfo } from './oauth/lichess';
import { testSignInPlugin } from './test-sign-in-session';

const DAY = 60 * 60 * 24;
const LICHESS = 'lichess';

/**
 * The `?error=` code the OAuth callback redirects with when a Lichess
 * sign-in would join an existing account by its email (R-69, R-83). The
 * sign-in page translates it.
 */
export const LICHESS_EMAIL_IN_USE = 'lichess_email_in_use';

export interface AuthDeps {
  readonly db: Db;
  readonly env: WebEnv;
  readonly mail: Mailer;
  /** The fetch Lichess identity calls use; feature tests pass a fake. */
  readonly fetch?: typeof fetch;
}

type UserOptions = NonNullable<BetterAuthOptions['user']>;
type ValidateUserInfo = NonNullable<UserOptions['validateUserInfo']>;
type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;

/** Folds the email Better Auth was handed, or refuses it (security item 6). */
function canonicalOrRefuse(raw: unknown): string {
  const email = canonicalEmail(typeof raw === 'string' ? raw : '');
  if (!email.ok) {
    const { reason } = email.refusal;
    throw new APIError('BAD_REQUEST', { code: reason, message: reason });
  }
  return email.value;
}

const requestBody = z.looseObject({ email: z.unknown() });

interface HookRequest {
  readonly path?: string | undefined;
  readonly body?: unknown;
}

type HookAnswer = { context: { body: Record<string, unknown> } } | undefined;

/**
 * The magic-link request with its email canonical, so the verification
 * token records the one form the account is keyed by, and with no name:
 * only Google or Lichess prefill the display name (R-81). Better Auth merges
 * this body into the request's, so the name is blanked rather than dropped
 * (an absent key would keep the client's value).
 */
function canonicalMagicLinkBody(ctx: HookRequest): HookAnswer {
  if (ctx.path !== '/sign-in/magic-link') return undefined;
  const parsed = requestBody.safeParse(ctx.body);
  const body = parsed.success ? parsed.data : { email: undefined };
  const email = canonicalOrRefuse(body.email);
  return { context: { body: { ...body, email, name: '' } } };
}

// Request fields that would let the client choose what the provider is
// asked for, or skip the redirect with its own id token.
const CLIENT_OAUTH_FIELDS = [
  'scopes',
  'additionalParams',
  'loginHint',
  'idToken',
];
const OAUTH_START_PATHS = new Set(['/sign-in/social', '/link-social']);

const clientOAuthField = (body: unknown): string | undefined => {
  const parsed = z.looseObject({}).safeParse(body);
  const keys = parsed.success ? Object.keys(parsed.data) : [];
  return CLIENT_OAUTH_FIELDS.find((field) => keys.includes(field));
};

/**
 * Refuses an OAuth start that names its own scopes, provider parameters,
 * login hint or id token. Better Auth merges a hook's body into the
 * request's, so the fields cannot be dropped, only refused.
 */
function refuseClientOAuthFields(ctx: HookRequest): void {
  if (ctx.path === undefined || !OAUTH_START_PATHS.has(ctx.path)) return;
  const field = clientOAuthField(ctx.body);
  if (field === undefined) return;
  throw new APIError('BAD_REQUEST', {
    code: 'unsupported_oauth_field',
    message: field,
  });
}

// Every request, before Better Auth handles it.
function beforeRequest(ctx: HookRequest): Promise<HookAnswer> {
  return Promise.resolve(ctx).then((request) => {
    refuseClientOAuthFields(request);
    return canonicalMagicLinkBody(request);
  });
}

/**
 * Lichess joins an existing account only from settings, while signed in to
 * that account (R-69, R-83). Better Auth calls this before every provider
 * link: the settings link and the implicit link at sign-in by email alike.
 * Only a flow started by `/link-social` for this account carries `link` in
 * its OAuth state, so a plain sign-in by a signed-in person is refused too.
 * A new Lichess sign-up is `create-user`, not a link, so it passes.
 */
const guardLichessLink: ValidateUserInfo = async ({ user, source }, ctx) => {
  if (source.action !== 'link-account') return;
  if (source.oauth?.providerId !== LICHESS) return;
  const state = await getOAuthState();
  const current = await getAuthoritativeSessionFromCtx(ctx);
  if (state?.link?.userId === user.id && current?.user.id === user.id) return;
  return { error: LICHESS_EMAIL_IN_USE };
};

/**
 * A disabled account opens no session (security item 8). An account our
 * connection cannot see yet is one Better Auth is creating in this request;
 * the sessions table's foreign key still demands it exists.
 */
async function isNotDisabled(db: Db, accountId: string): Promise<boolean> {
  const account = await findAccountById(db, accountId);
  return (account?.disabledAt ?? null) === null;
}

function databaseHooks(db: Db): DatabaseHooks {
  return {
    user: {
      create: {
        before: (account) =>
          Promise.resolve({
            data: { ...account, email: canonicalOrRefuse(account.email) },
          }),
      },
    },
    session: {
      create: {
        before: (session) => isNotDisabled(db, session.userId),
      },
    },
  };
}

// Our fields are never client input: no request can set them (decision 8).
const accountFields = {
  locale: { type: 'string', defaultValue: DEFAULT_LOCALE, input: false },
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

const userOptions = {
  modelName: 'accounts',
  fields: { name: 'displayName' },
  additionalFields: accountFields,
  validateUserInfo: guardLichessLink,
} satisfies UserOptions;

const sessionOptions = {
  modelName: 'sessions',
  fields: { userId: 'accountId' },
  expiresIn: 90 * DAY,
  updateAge: DAY,
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

const metadataSchema = z.object({ locale: z.enum(LOCALES) }).partial();

function magicLinkPlugin(mail: Mailer) {
  return magicLink({
    expiresIn: 15 * 60,
    storeToken: 'hashed',
    sendMagicLink: async ({ email, url, metadata }) => {
      const parsed = metadataSchema.safeParse(metadata ?? {});
      const locale = resolveLocale(parsed.success ? parsed.data.locale : '');
      await mail.send(magicLinkMail(locale, email, url));
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

function authOptions({ db, env, mail, fetch: fetchImpl = fetch }: AuthDeps) {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    disabledPaths: DISABLED_PATHS,
    user: userOptions,
    session: sessionOptions,
    account: providerAccountOptions,
    verification: { modelName: 'verifications' },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        getUserInfo: googleUserInfo,
        disableIdTokenSignIn: true,
      },
    },
    hooks: { before: createAuthMiddleware(beforeRequest) },
    databaseHooks: databaseHooks(db),
    plugins: [
      magicLinkPlugin(mail),
      lichessPlugin(env, fetchImpl),
      testSignInPlugin,
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

export type Auth = BetterAuth<ReturnType<typeof authOptions>>;

/** Better Auth on `deps` (ADR 0010); feature tests build it on a test database. */
export function createAuth(deps: AuthDeps): Auth {
  return betterAuth(authOptions(deps));
}

let auth: Auth | undefined;

/** The app's Better Auth instance, built on first use. */
export function getAuth(): Auth {
  if (auth === undefined) {
    const env = readWebEnv();
    auth = createAuth({ db: getDb(), env, mail: createMailer(env) });
  }
  return auth;
}

/**
 * Finds or creates the persona account for a canonical `@mychess.test`
 * email and starts a session; returns its Set-Cookie, or undefined for a
 * disabled account. Only the staging test route calls it (R-73).
 */
export async function signInForTest(
  authInstance: Auth,
  email: string,
): Promise<string | undefined> {
  const { cookie } = await authInstance.api.startTestSession({
    body: { email },
  });
  return cookie;
}
