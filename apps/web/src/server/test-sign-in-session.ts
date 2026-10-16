import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { makeSignature } from 'better-auth/crypto';
import { z } from 'zod';
import { PERSONA_DOMAIN } from './test-sign-in';

const bodySchema = z.object({ email: z.string().endsWith(PERSONA_DOMAIN) });

// Better Auth types the session as always created, but a database hook that
// refuses it (a disabled account) makes it null.
const startedSession = z.object({ token: z.string() }).nullable();

interface CookieAttributes {
  readonly domain?: string | undefined;
  readonly path?: string | undefined;
  readonly httpOnly?: boolean | undefined;
  readonly secure?: boolean | undefined;
  readonly sameSite?: string | undefined;
  readonly partitioned?: boolean | undefined;
}

const capitalised = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** The attributes in the order Better Auth's own cookie serialiser writes them. */
function attributeParts(maxAge: number, a: CookieAttributes): string[] {
  return [
    `Max-Age=${String(maxAge)}`,
    a.domain === undefined ? '' : `Domain=${a.domain}`,
    `Path=${a.path ?? '/'}`,
    a.httpOnly === false ? '' : 'HttpOnly',
    a.secure === true ? 'Secure' : '',
    `SameSite=${capitalised(a.sameSite ?? 'lax')}`,
    a.partitioned === true ? 'Partitioned' : '',
  ].filter((part) => part !== '');
}

/**
 * Better Auth's session cookie for `token`, signed with the auth secret and
 * carrying the session cookie's own attributes (Secure where the auth URL
 * is https), as Better Auth's test-utils `createTestCookie` builds it.
 */
async function sessionCookie(
  cookie: { readonly name: string; readonly attributes: CookieAttributes },
  secret: string,
  token: string,
  maxAge: number,
): Promise<string> {
  const value = encodeURIComponent(
    `${token}.${await makeSignature(token, secret)}`,
  );
  return [
    `${cookie.name}=${value}`,
    ...attributeParts(maxAge, cookie.attributes),
  ].join('; ');
}

/**
 * The persona sign-in's session start (R-73): server-only, never on the HTTP
 * router, so only `signInForTest` reaches it. It runs inside Better Auth's
 * endpoint context, so creating the account and the session goes through
 * `validateUserInfo` and the database hooks like any other sign-in: the
 * email is canonical, and a disabled account gets no session. Where the
 * route answers 404 (`enabled` false) it refuses too, before touching the
 * database: a second lock should a caller skip the route's check.
 */
const startTestSession = (enabled: boolean) =>
  createAuthEndpoint.serverOnly(
    { method: 'POST', body: bodySchema },
    async (ctx) => {
      if (!enabled) throw new APIError('NOT_FOUND');
      const { internalAdapter, authCookies, secret, sessionConfig } =
        ctx.context;
      const { email } = ctx.body;
      const found = await internalAdapter.findUserByEmail(email);
      const account =
        found?.user ??
        (await internalAdapter.createUser(
          { email, name: '', emailVerified: true },
          { method: 'test-sign-in' },
        ));
      const session = startedSession.parse(
        await internalAdapter.createSession(account.id),
      );
      if (session === null) return { cookie: undefined };
      return {
        cookie: await sessionCookie(
          authCookies.sessionToken,
          secret,
          session.token,
          sessionConfig.expiresIn,
        ),
      };
    },
  );

/**
 * Registers the server-only persona sign-in endpoint on Better Auth;
 * `enabled` is `testSignInEnabled` for the environment the auth is built on.
 */
export function testSignInPlugin(enabled: boolean): TestSignInPlugin {
  return {
    id: 'mychess-test-sign-in',
    endpoints: { startTestSession: startTestSession(enabled) },
  } satisfies BetterAuthPlugin;
}

interface TestSignInPlugin {
  readonly id: 'mychess-test-sign-in';
  readonly endpoints: {
    readonly startTestSession: ReturnType<typeof startTestSession>;
  };
}
