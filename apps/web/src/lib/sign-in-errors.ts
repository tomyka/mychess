/**
 * The `?error=` code the OAuth callback redirects with when a Lichess
 * sign-in would join an existing account by its email (R-69, R-83). The
 * sign-in page translates it.
 */
export const LICHESS_EMAIL_IN_USE = 'lichess_email_in_use';

/** The catalogue key of every error the sign-in page can show. */
export type SignInErrorKey =
  | 'signIn.error.lichessEmailInUse'
  | 'signIn.error.tooManyRequests'
  | 'signIn.error.generic'
  | 'account.emailInvalid';

// Better Auth names a refused implicit link `account_not_linked`; ours is
// LICHESS_EMAIL_IN_USE. A Map, so a code such as `constructor` finds nothing.
const KNOWN_CODES = new Map<string, SignInErrorKey>([
  [LICHESS_EMAIL_IN_USE, 'signIn.error.lichessEmailInUse'],
  ['account_not_linked', 'signIn.error.lichessEmailInUse'],
  ['account.emailInvalid', 'account.emailInvalid'],
]);

/** The message for an error code from Better Auth; the general one if unknown. */
export function signInErrorKey(code: string | undefined): SignInErrorKey {
  return KNOWN_CODES.get(code ?? '') ?? 'signIn.error.generic';
}

/** A refusal as Better Auth's client returns it. */
export interface ClientError {
  readonly status: number;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

const TOO_MANY_REQUESTS = 429;

/** The message for a refused sign-in request. */
export function clientErrorKey(error: ClientError): SignInErrorKey {
  if (error.status === TOO_MANY_REQUESTS) return 'signIn.error.tooManyRequests';
  return signInErrorKey(error.code ?? error.message);
}
