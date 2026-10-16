/**
 * The `?error=` code the OAuth callback redirects with when a Lichess
 * sign-in would join an existing account by its email (R-69, R-83). The
 * sign-in page translates it.
 */
export const LICHESS_EMAIL_IN_USE = 'lichess_email_in_use';

/**
 * The `?error=` code for any other provider identity refused from joining
 * an existing account by its email; the sign-in page shows the general
 * message for it.
 */
export const JOIN_REFUSED = 'join_refused';

/** The catalogue key of every error the sign-in page can show. */
export type SignInErrorKey =
  | 'signIn.error.lichessEmailInUse'
  | 'signIn.error.linkExpired'
  | 'signIn.error.tooManyRequests'
  | 'signIn.error.generic'
  | 'account.emailInvalid';

// Better Auth names a refused implicit link `account_not_linked`; ours is
// LICHESS_EMAIL_IN_USE. A magic link that expired, was already used or is
// unknown comes back as `INVALID_TOKEN`. A Map, so a code such as
// `constructor` finds nothing.
const KNOWN_CODES = new Map<string, SignInErrorKey>([
  [LICHESS_EMAIL_IN_USE, 'signIn.error.lichessEmailInUse'],
  ['account_not_linked', 'signIn.error.lichessEmailInUse'],
  ['INVALID_TOKEN', 'signIn.error.linkExpired'],
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

/**
 * Better Auth's code for a session older than its freshAge (a day); our
 * link guard answers a link start with it too.
 */
export const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH';

/** The catalogue key of every error the settings page's provider links show. */
export type LinkErrorKey =
  | 'settings.providers.error.notFresh'
  | 'settings.providers.error.linkedElsewhere'
  | 'settings.providers.error.generic';

// Linking or unlinking from a session older than a day answers
// SESSION_NOT_FRESH; a provider account another mychess account holds comes
// back from the link callback as `account_already_linked_to_different_user`.
const LINK_CODES = new Map<string, LinkErrorKey>([
  [SESSION_NOT_FRESH, 'settings.providers.error.notFresh'],
  [
    'account_already_linked_to_different_user',
    'settings.providers.error.linkedElsewhere',
  ],
]);

/** The message for a failed link or unlink; the general one if unknown. */
export function linkErrorKey(code: string | undefined): LinkErrorKey {
  return LINK_CODES.get(code ?? '') ?? 'settings.providers.error.generic';
}
