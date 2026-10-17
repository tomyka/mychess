import { completeOnboarding, type Db } from '@mychess/db';
import { createAuth, type Auth } from '../../../src/server/auth';
import { webEnvSchema, type WebEnv } from '../../../src/server/env';
import type { MailMessage } from '../../../src/server/mail';

export const BASE = 'http://localhost:3000';

/** The variables a feature-test server reads, as the process sees them. */
export const TEST_ENV_VARS: Readonly<Record<string, string>> = {
  DATABASE_URL: 'postgres://unused:unused@localhost:1/unused',
  BETTER_AUTH_SECRET: 'feature-test-secret-feature-test-secret',
  BETTER_AUTH_URL: BASE,
  MAIL_TRANSPORT: 'mailpit',
  MAIL_FROM: 'mychess <noreply@mychess.test>',
  MAILPIT_URL: 'http://localhost:8025',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  LICHESS_CLIENT_ID: 'mychess-test',
};

function testEnv(vars: Readonly<Record<string, string>>): WebEnv {
  return webEnvSchema.parse({ ...TEST_ENV_VARS, ...vars });
}

export interface BuiltAuth {
  readonly auth: Auth;
  /** Every mail the auth sent, oldest first. */
  readonly sent: MailMessage[];
}

export interface TestAuthOptions {
  /** The fetch Lichess identity calls use. */
  readonly fetch?: typeof fetch;
  /** Variables that replace the feature-test ones (TEST_ENV_VARS). */
  readonly env?: Readonly<Record<string, string>>;
}

/** Better Auth on the test database, with a mailer that keeps what it sends. */
export function buildTestAuth(
  db: Db,
  { fetch: fetchImpl, env = {} }: TestAuthOptions = {},
): BuiltAuth {
  const sent: MailMessage[] = [];
  const auth = createAuth({
    db,
    env: testEnv(env),
    mail: {
      send: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
    },
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  return { auth, sent };
}

/** The session cookie a response set, as a Cookie request header. */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/**
 * Asks for a magic link with `body` (an email and options), from a client
 * with `headers` (such as its address), without following it.
 */
export function requestMagicLink(
  built: BuiltAuth,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return built.auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** The link in the last mail `built` sent, if any. */
export function mailedLink(built: BuiltAuth): string | undefined {
  return /https?:\/\/\S+/.exec(built.sent.at(-1)?.text ?? '')?.[0];
}

/** Requests a magic link for `email` and follows it; returns the signed-in cookie. */
export async function signInByMagicLink(
  built: BuiltAuth,
  email: string,
): Promise<string> {
  await requestMagicLink(built, { email, callbackURL: '/' });
  const link = mailedLink(built);
  if (link === undefined) throw new Error('no magic link was mailed');
  return cookieFrom(await built.auth.handler(new Request(link)));
}

/** What onboarding asks for (R-81). */
export interface Profile {
  readonly displayName: string;
  readonly locale: 'lt' | 'en';
}

/** Onboards the account `cookie` is signed in to; returns its id. */
export async function onboard(
  built: BuiltAuth,
  db: Db,
  cookie: string,
  profile: Profile,
): Promise<string> {
  const session = await built.auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  if (session === null) throw new Error('the cookie is not signed in');
  await completeOnboarding(db, session.user.id, profile, new Date());
  return session.user.id;
}

/** Signs `email` in by magic link and onboards it; returns the cookie. */
export async function signInOnboarded(
  built: BuiltAuth,
  db: Db,
  email: string,
  profile: Profile,
): Promise<string> {
  const cookie = await signInByMagicLink(built, email);
  await onboard(built, db, cookie, profile);
  return cookie;
}
