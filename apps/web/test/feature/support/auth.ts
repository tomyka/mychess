import type { Db } from '@mychess/db';
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

function testEnv(): WebEnv {
  return webEnvSchema.parse(TEST_ENV_VARS);
}

export interface BuiltAuth {
  readonly auth: Auth;
  /** Every mail the auth sent, oldest first. */
  readonly sent: MailMessage[];
}

/** Better Auth on the test database, with a mailer that keeps what it sends. */
export function buildTestAuth(db: Db, fetchImpl?: typeof fetch): BuiltAuth {
  const sent: MailMessage[] = [];
  const auth = createAuth({
    db,
    env: testEnv(),
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

/** Requests a magic link for `email` and follows it; returns the signed-in cookie. */
export async function signInByMagicLink(
  built: BuiltAuth,
  email: string,
): Promise<string> {
  await built.auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, callbackURL: '/' }),
    }),
  );
  const link = /https?:\/\/\S+/.exec(built.sent.at(-1)?.text ?? '')?.[0];
  if (link === undefined) throw new Error('no magic link was mailed');
  return cookieFrom(await built.auth.handler(new Request(link)));
}
