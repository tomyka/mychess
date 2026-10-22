import { authSchema, findAccountById, type Db } from '@mychess/db';
import {
  canLinkProvider,
  canOpenSession,
  canStartOAuth,
  decideProviderJoin,
  DEFAULT_ENTITLEMENT,
  DEFAULT_LOCALE,
  FRESH_AGE_SECONDS,
  LOCALES,
  MAGIC_LINK_RATE_LIMIT,
  type ProviderJoin,
  magicLinkRequest,
  signInEmail,
} from '@mychess/domain';
import {
  betterAuth,
  type Auth as BetterAuth,
  type BetterAuthOptions,
} from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { revokeUnprovenAccountAccess } from 'better-auth/db';
import {
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getOAuthState,
} from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { z } from 'zod';
import { resolveLocale } from '../i18n/locales';
import { ROUTES } from '../lib/routes';
import { refusalCode, refusalError } from './auth-refusal';
import { getDb } from './db';
import { googleConfigured, readWebEnv, type WebEnv } from './env';
import { createMailer, magicLinkMail, type Mailer } from './mail';
import { googleUserInfo } from './oauth/google';
import { noteLichessUnlinked } from './lichess-unlinked';
import { LICHESS_PROVIDER_ID, lichessUserInfo } from './oauth/lichess';
import { endUnlinkedProviderSession } from './provider-session';
import { linkWithLocale, signUpLocale } from './sign-up-locale';
import { testSignInPlugin } from './test-sign-in';

const DAY = 60 * 60 * 24;

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
  const request = magicLinkRequest(body.email);
  if (!request.ok) throw refusalError(request.refusal);
  return { context: { body: { ...body, ...request.value } } };
}

const OAUTH_START_PATHS = new Set(['/sign-in/social', '/link-social']);

/** The fields a request body names; none when it is not an object. */
const fieldsOf = (body: unknown): string[] => {
  const parsed = z.looseObject({}).safeParse(body);
  return parsed.success ? Object.keys(parsed.data) : [];
};

/**
 * Refuses an OAuth start that names its own scopes, provider parameters,
 * login hint or id token. Better Auth merges a hook's body into the
 * request's, so the fields cannot be dropped, only refused.
 */
function refuseClientOAuthFields(ctx: HookRequest): void {
  if (ctx.path === undefined || !OAUTH_START_PATHS.has(ctx.path)) return;
  const start = canStartOAuth(fieldsOf(ctx.body));
  if (!start.ok) throw refusalError(start.refusal);
}

type HookContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];

const LINK_PATH = '/link-social';

/**
 * Linking a provider needs a fresh session, as unlinking does, so a stolen
 * old session cannot attach the thief's Google or Lichess as a way in. The
 * same code as unlink's, so settings shows the same message. A request with
 * no session is left to Better Auth, which refuses it.
 */
async function refuseStaleLink(ctx: HookContext): Promise<void> {
  if (ctx.path !== LINK_PATH) return;
  const current = await getAuthoritativeSessionFromCtx(ctx);
  if (current === null) return;
  const link = canLinkProvider(new Date(current.session.createdAt), new Date());
  if (!link.ok) throw refusalError(link.refusal);
}

// Every request, before Better Auth handles it.
async function beforeRequest(ctx: HookContext): Promise<HookAnswer> {
  refuseClientOAuthFields(ctx);
  await refuseStaleLink(ctx);
  return canonicalMagicLinkBody(ctx);
}

type UserInfo = Parameters<ValidateUserInfo>[0];
type UserInfoAnswer = Awaited<ReturnType<ValidateUserInfo>>;

/** The account Better Auth is about to link the identity to, if it names one. */
const idOf = (user: UserInfo['user']): string | undefined =>
  typeof user.id === 'string' ? user.id : undefined;

/**
 * A link from settings (`/link-social` put `link` in the OAuth state). The
 * domain lets Lichess join only while signed in to that very account (R-69,
 * R-83); Better Auth itself joins any other provider to the session's
 * account only. The session is read for Lichess alone, the one link the
 * domain checks against it.
 */
async function settingsJoin(
  { user, source }: UserInfo,
  ctx: HookContext,
  linkAccountId: string,
): Promise<ProviderJoin> {
  const provider = source.oauth?.providerId;
  const current =
    provider === LICHESS_PROVIDER_ID
      ? await getAuthoritativeSessionFromCtx(ctx)
      : null;
  return {
    via: 'settings',
    provider,
    linkAccountId,
    targetAccountId: idOf(user),
    sessionAccountId: current?.user.id,
  };
}

/** A provider joining the account with its email at sign-in. */
async function emailJoin(
  db: Db,
  { user, source }: UserInfo,
): Promise<ProviderJoin> {
  const accountId = idOf(user);
  const account =
    accountId === undefined ? undefined : await findAccountById(db, accountId);
  return {
    via: 'email',
    provider: source.oauth?.providerId,
    emailVerified: user.emailVerified,
    account,
  };
}

/**
 * The domain's answer to a join, denied unless allowed (A1). A verified
 * Google email proves the mailbox, as a magic link does (R-87): if the
 * account is unproven (a Lichess sign-up under the address), Better Auth's
 * own magic-link clean-up ends the access it gathered before the proof
 * (provider links and sessions) and marks the email verified, so Google
 * joins an account the mailbox owner alone holds. The clean-up re-reads the
 * account under its own lock, so it runs for every allowed proof.
 */
async function answerJoin(
  join: ProviderJoin,
  ctx: HookContext,
): Promise<UserInfoAnswer> {
  const decision = decideProviderJoin(join);
  if (!decision.ok) return { error: refusalCode(decision.refusal) };
  if (decision.value.kind === 'proveEmail')
    await revokeUnprovenAccountAccess(ctx, decision.value.accountId);
  return undefined;
}

/**
 * Every provider identity, before it joins or creates an account. Better
 * Auth calls it before every provider link: the settings link and the
 * implicit link at sign-in by email alike; only the former carries `link`
 * in its OAuth state, so a plain sign-in by a signed-in person is an
 * implicit join too. A new sign-up is `create-user`, not a link, and passes.
 */
function validateUserInfo(db: Db): ValidateUserInfo {
  return async (data, ctx) => {
    if (data.source.action !== 'link-account') return;
    const link = (await getOAuthState())?.link;
    const join =
      link === undefined
        ? await emailJoin(db, data)
        : await settingsJoin(data, ctx, link.userId);
    return answerJoin(join, ctx);
  };
}

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
        // Canonical email (security item 6); the language the person was
        // using (R-85).
        before: (account, ctx) =>
          Promise.resolve({
            data: {
              ...account,
              email: newAccountEmail(account.email),
              locale: signUpLocale(ctx),
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
    trustedProviders: [LICHESS_PROVIDER_ID],
    // An unproven account may be joined: only Google is, and it first ends
    // the unproven access (validateUserInfo, decideProviderJoin, R-87).
    requireLocalEmailVerified: false,
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
      const asked = parsed.success ? parsed.data.locale : undefined;
      const link = linkWithLocale(url, asked);
      await mail.send(magicLinkMail(resolveLocale(asked), email, link));
    },
  });
}

function lichessPlugin(env: WebEnv, fetchImpl: typeof fetch) {
  return genericOAuth({
    config: [
      {
        providerId: LICHESS_PROVIDER_ID,
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
 * failing (security A7). Staging and production require both (env.ts).
 */
function socialProviders(env: WebEnv) {
  if (!googleConfigured(env)) return {};
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      getUserInfo: googleUserInfo,
      disableIdTokenSignIn: true,
    },
  };
}

/**
 * Request limits per client address and path, counted in the database:
 * in-memory counters do nothing across serverless instances (security A6).
 * Always on: Better Auth's default turns them off outside NODE_ENV
 * production. A magic link is mailed at most three times a minute per
 * address; Better Auth's own rules cover the other sign-in paths.
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
 * The client address as Vercel forwards it: Vercel sets both headers to
 * the client's IP and overwrites any value the client sent.
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
    socialProviders: socialProviders(env),
    rateLimit: rateLimitOptions,
    advanced: advancedOptions,
    // An error with no errorCallbackURL of its own lands on our sign-in
    // page, which translates its code, not on Better Auth's /error page.
    onAPIError: { errorURL: new URL(ROUTES.signIn, env.BETTER_AUTH_URL).href },
    hooks: { before: createAuthMiddleware(beforeRequest) },
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

let mailer: Mailer | undefined;

/** The app's mailer, built on first use: one per server process. */
export function getMailer(): Mailer {
  mailer ??= createMailer(readWebEnv());
  return mailer;
}

let auth: Auth | undefined;

/** The app's Better Auth instance, built on first use. */
export function getAuth(): Auth {
  auth ??= createAuth({ db: getDb(), env: readWebEnv(), mail: getMailer() });
  return auth;
}
