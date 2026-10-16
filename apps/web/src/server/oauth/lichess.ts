import { z } from 'zod';

const accountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
});
const emailSchema = z.object({ email: z.string().min(1) });

const LICHESS = 'https://lichess.org';

// Open to more fields, as Better Auth's generic OAuth profile type is.
interface LichessIdentity extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: false;
}

export type LichessUserInfo = (tokens: {
  accessToken?: string | undefined;
}) => Promise<LichessIdentity | null>;

const TIMEOUT_MS = 10_000;

// A Lichess API answer as JSON, or undefined when Lichess refused, did not
// answer in time or answered with something that is not JSON.
async function lichessJson(
  fetchImpl: typeof fetch,
  path: string,
  authorization: string,
): Promise<unknown> {
  try {
    const response = await fetchImpl(`${LICHESS}${path}`, {
      headers: { authorization },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Lichess identity behind an access token (scope `email:read`, R-83).
 * Lichess does not say the email is verified, so it is reported unverified;
 * the Lichess link guard in auth.ts keeps it from joining an existing
 * account by email (R-69, R-83).
 */
export function lichessUserInfo(
  fetchImpl: typeof fetch = fetch,
): LichessUserInfo {
  return async (tokens) => {
    if (tokens.accessToken === undefined) return null;
    const authorization = `Bearer ${tokens.accessToken}`;
    const [account, email] = await Promise.all([
      lichessJson(fetchImpl, '/api/account', authorization),
      lichessJson(fetchImpl, '/api/account/email', authorization),
    ]);
    const a = accountSchema.safeParse(account);
    const e = emailSchema.safeParse(email);
    if (!a.success || !e.success) return null;
    return {
      id: a.data.id,
      name: a.data.username,
      email: e.data.email,
      emailVerified: false,
    };
  };
}
