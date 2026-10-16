import { timingSafeEqual } from 'node:crypto';
import { canonicalEmail } from '@mychess/domain';
import { z } from 'zod';
import type { WebEnv } from './env';

/** The only domain the persona sign-in accepts (R-73, docs/personas/). */
export const PERSONA_DOMAIN = '@mychess.test';

export interface TestSignInDeps {
  readonly env: Pick<
    WebEnv,
    'MYCHESS_ENV' | 'MYCHESS_TEST_SIGNIN' | 'TEST_SIGNIN_SECRET'
  >;
  /**
   * Finds or creates the account for a canonical persona email and starts a
   * session; returns its Set-Cookie, or undefined when the account may not
   * sign in (a disabled account).
   */
  readonly signIn: (email: string) => Promise<string | undefined>;
}

const bodySchema = z.object({ email: z.string() });

const status = (code: number) => new Response(null, { status: code });

const sameSecret = (given: string, expected: string): boolean =>
  given.length === expected.length &&
  timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** The configured secret, or undefined when the route must not exist. */
function enabledSecret(env: TestSignInDeps['env']): string | undefined {
  if (env.MYCHESS_ENV === 'production' || !env.MYCHESS_TEST_SIGNIN)
    return undefined;
  return env.TEST_SIGNIN_SECRET;
}

/** The canonical persona email the request names, or undefined. */
async function personaEmail(request: Request): Promise<string | undefined> {
  const raw: unknown = await request.json().catch(() => null);
  const body = bodySchema.safeParse(raw);
  const email = canonicalEmail(body.success ? body.data.email : '');
  return email.ok && email.value.endsWith(PERSONA_DOMAIN)
    ? email.value
    : undefined;
}

/**
 * Persona sign-in for staging (R-73): absent (404) in production and unless
 * the flag and secret are set; otherwise only a `@mychess.test` email with the
 * shared secret in `x-test-secret` (403 for anything else).
 */
export async function testSignIn(
  request: Request,
  { env, signIn }: TestSignInDeps,
): Promise<Response> {
  const secret = enabledSecret(env);
  if (secret === undefined) return status(404);
  if (!sameSecret(request.headers.get('x-test-secret') ?? '', secret))
    return status(403);
  const email = await personaEmail(request);
  if (email === undefined) return status(403);
  const cookie = await signIn(email);
  if (cookie === undefined) return status(403);
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
}
