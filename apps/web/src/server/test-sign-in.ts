import { timingSafeEqual } from 'node:crypto';
import { personaEmail, personaSignInAvailable } from '@mychess/domain';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import type { WebEnv } from './env';

/**
 * The persona sign-in for local and staging (R-73, R-93), in one place: the
 * route's answer (`testSignIn`) and the Better Auth plugin whose server-only
 * endpoint starts the session (`testSignInPlugin`). Production never has it:
 * the environment refuses the switch there (env.ts), and both halves refuse
 * it again should a caller hand them a production environment.
 */

type SwitchEnv = Pick<WebEnv, 'MYCHESS_ENV' | 'MYCHESS_TEST_SIGNIN'>;

/**
 * A persona's canonical email, as the domain decides it (R-73); a refusal
 * becomes the issue, its reason the message.
 */
const personaEmailField = z.string().transform((raw, ctx) => {
  const email = personaEmail(raw);
  if (email.ok) return email.value;
  ctx.addIssue({ code: 'custom', message: email.refusal.reason });
  return z.NEVER;
});

const testSignInBody = z.object({ email: personaEmailField });

/** Whether the persona sign-in exists, as the domain decides it (R-73, R-93). */
const enabled = (env: SwitchEnv): boolean =>
  personaSignInAvailable({
    production: env.MYCHESS_ENV === 'production',
    switchedOn: env.MYCHESS_TEST_SIGNIN,
  });

// Better Auth types the session as always created, but a database hook that
// refuses it (a disabled account) makes it null.
const startedSession = z.looseObject({ token: z.string() }).nullable();

/**
 * Finds or creates the persona account and starts its session; Better Auth
 * sets the session cookie on the endpoint's answer. Server-only, never on
 * the HTTP router. It runs inside Better Auth's endpoint context, so the
 * account and session go through `validateUserInfo` and the database hooks
 * like any other sign-in: a disabled account gets no session and no cookie.
 * Where the route answers 404 it refuses too, before touching the database.
 */
const startTestSession = (on: boolean) =>
  createAuthEndpoint.serverOnly(
    { method: 'POST', body: testSignInBody },
    async (ctx) => {
      if (!on) throw new APIError('NOT_FOUND');
      const { internalAdapter } = ctx.context;
      const { email } = ctx.body;
      const found = await internalAdapter.findUserByEmail(email);
      const user =
        found?.user ??
        (await internalAdapter.createUser(
          { email, name: '', emailVerified: true },
          { method: 'test-sign-in' },
        ));
      const created = await internalAdapter.createSession(user.id);
      if (startedSession.parse(created) === null) return null;
      await setSessionCookie(ctx, { session: created, user });
      return null;
    },
  );

interface TestSignInPlugin {
  readonly id: 'mychess-test-sign-in';
  readonly endpoints: {
    readonly startTestSession: ReturnType<typeof startTestSession>;
  };
}

/** Registers the persona sign-in's session start on Better Auth for `env`. */
export function testSignInPlugin(env: SwitchEnv): TestSignInPlugin {
  return {
    id: 'mychess-test-sign-in',
    endpoints: { startTestSession: startTestSession(enabled(env)) },
  } satisfies BetterAuthPlugin;
}

export interface TestSignInDeps {
  readonly env: SwitchEnv & Pick<WebEnv, 'TEST_SIGNIN_SECRET'>;
  /** The app's Better Auth, with `testSignInPlugin` registered. */
  readonly auth: {
    readonly api: {
      readonly startTestSession: (input: {
        readonly body: z.output<typeof testSignInBody>;
        readonly returnHeaders: true;
      }) => Promise<{ readonly headers: Headers }>;
    };
  };
}

const status = (code: number) => new Response(null, { status: code });

/** Compares bytes, not characters: a non-ASCII header is longer in bytes. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The configured secret, or undefined when the route must not exist. */
const enabledSecret = (env: TestSignInDeps['env']): string | undefined =>
  enabled(env) ? env.TEST_SIGNIN_SECRET : undefined;

/** The persona the request names, or undefined. */
async function requestedPersona(
  request: Request,
): Promise<z.output<typeof testSignInBody> | undefined> {
  const raw: unknown = await request.json().catch(() => null);
  return testSignInBody.safeParse(raw).data;
}

/**
 * `POST /api/test/sign-in`: absent (404) in production and unless the flag
 * and secret are set; otherwise only a persona email with the shared
 * secret in `x-test-secret` (403 for anything else, and for a disabled
 * account). A signed-in persona gets Better Auth's own session cookie.
 */
export async function testSignIn(
  request: Request,
  { env, auth }: TestSignInDeps,
): Promise<Response> {
  const secret = enabledSecret(env);
  if (secret === undefined) return status(404);
  if (!sameSecret(request.headers.get('x-test-secret') ?? '', secret))
    return status(403);
  const body = await requestedPersona(request);
  if (body === undefined) return status(403);
  const { headers } = await auth.api.startTestSession({
    body,
    returnHeaders: true,
  });
  const cookies = headers.getSetCookie();
  if (cookies.length === 0) return status(403);
  const answer = new Headers();
  for (const cookie of cookies) answer.append('set-cookie', cookie);
  return new Response(null, { status: 204, headers: answer });
}
