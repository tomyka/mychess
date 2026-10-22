import { ok, refuse, type Result } from '@mychess/chess';
import {
  ACCOUNT_REFUSALS,
  canonicalEmail,
  isDisabled,
  type Account,
  type AccountRefusal,
} from './account';

/**
 * The sign-in rules of an Account, as pure decisions. The auth adapter
 * reads its framework's input, asks these and maps a refusal to its wire
 * answer; nothing here knows of paths, bodies, cookies or headers.
 */

/** The OAuth providers an account signs in with and links (R-68, R-69, R-83). */
export const GOOGLE = 'google';
export const LICHESS = 'lichess';
export const PROVIDERS = [GOOGLE, LICHESS] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isProvider = (value: string): value is Provider =>
  PROVIDERS.some((provider) => provider === value);

/** Sign-in refusal reasons; the adapter maps each to today's wire answer. */
export const SIGN_IN_REFUSALS = {
  lichessEmailInUse: 'signIn.lichessEmailInUse',
  joinRefused: 'signIn.joinRefused',
  sessionNotFresh: 'signIn.sessionNotFresh',
  clientOAuthField: 'signIn.clientOAuthField',
  accountDisabled: 'signIn.accountDisabled',
} as const;

export type SignInRefusalReason =
  (typeof SIGN_IN_REFUSALS)[keyof typeof SIGN_IN_REFUSALS];

export type SignInRefusal =
  | {
      readonly reason: Exclude<SignInRefusalReason, 'signIn.clientOAuthField'>;
    }
  | { readonly reason: 'signIn.clientOAuthField'; readonly field: string };

/**
 * The email a sign-in is keyed by: the canonical form of a string, and a
 * refusal for anything else, so a look-alike never becomes a second account
 * (security item 6). Every new account and every magic-link request use it.
 */
export function signInEmail(raw: unknown): Result<string, AccountRefusal> {
  return typeof raw === 'string'
    ? canonicalEmail(raw)
    : refuse(ACCOUNT_REFUSALS.emailInvalid);
}

/**
 * A magic-link request: its canonical email, and a blank name, because only
 * Google or Lichess prefill the display name (R-81).
 */
export function magicLinkRequest(
  raw: unknown,
): Result<{ email: string; name: '' }, AccountRefusal> {
  const email = signInEmail(raw);
  return email.ok ? ok({ email: email.value, name: '' }) : email;
}

/**
 * Request fields that would let the client choose what the provider is
 * asked for, or skip the redirect with its own id token (security item 7).
 */
export const CLIENT_OAUTH_FIELDS = [
  'scopes',
  'additionalParams',
  'loginHint',
  'idToken',
] as const;

/**
 * May an OAuth sign-in or link start with these request fields? Refused,
 * naming the first client-chosen field in `CLIENT_OAUTH_FIELDS` order
 * (security item 7).
 */
export function canStartOAuth(
  requestFields: readonly string[],
): Result<undefined, SignInRefusal> {
  const field = CLIENT_OAUTH_FIELDS.find((name) =>
    requestFields.includes(name),
  );
  return field === undefined
    ? ok()
    : refuse(SIGN_IN_REFUSALS.clientOAuthField, { field });
}

/**
 * How long after signing in a session stays fresh enough to link or unlink
 * a provider (R-84) or download the data export (R-95): a day. The auth
 * sets it as Better Auth's freshAge, so Better Auth's own checks agree.
 */
export const FRESH_AGE_SECONDS = 60 * 60 * 24;

const SECOND = 1000;

/** Did a session created at `createdAt` start less than a day before `now`? */
export function isFreshSession(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < FRESH_AGE_SECONDS * SECOND;
}

/**
 * Linking a provider needs a fresh session, as unlinking does (R-84), so a
 * stolen old session cannot attach the thief's Google or Lichess as a way in.
 */
export function canLinkProvider(
  sessionCreatedAt: Date,
  now: Date,
): Result<undefined, SignInRefusal> {
  return isFreshSession(sessionCreatedAt, now)
    ? ok()
    : refuse(SIGN_IN_REFUSALS.sessionNotFresh);
}

/** A disabled account opens no session (R-80, security item 8). */
export function canOpenSession(
  account: Account,
): Result<undefined, SignInRefusal> {
  return isDisabled(account) ? refuse(SIGN_IN_REFUSALS.accountDisabled) : ok();
}

/**
 * A provider identity about to join an existing account: from settings
 * (the OAuth state names the account to link) or by its email at sign-in.
 */
export type ProviderJoin =
  | {
      readonly via: 'settings';
      readonly provider: string | undefined;
      /** The account the OAuth state's `link` names. */
      readonly linkAccountId: string;
      /** The account Better Auth is about to link the identity to. */
      readonly targetAccountId: string | undefined;
      /** The account of the request's session, if any. */
      readonly sessionAccountId: string | undefined;
    }
  | {
      readonly via: 'email';
      readonly provider: string | undefined;
      /** What the provider says of the email; only `true` counts. */
      readonly emailVerified: unknown;
      /** The account with that email, as the database holds it. */
      readonly account: Account | undefined;
    };

/**
 * An allowed join: a plain link, or a proof of the email that first ends
 * the account's unproven access (R-87), which the adapter leaves to Better
 * Auth's own locked clean-up.
 */
export type JoinAllowed =
  | { readonly kind: 'link' }
  | { readonly kind: 'proveEmail'; readonly accountId: string };

type JoinResult = Result<JoinAllowed, SignInRefusal>;

/**
 * A link from settings. Lichess joins only while signed in to that very
 * account (R-69, R-83); Better Auth itself joins any other provider to the
 * session's account only, so it passes (spec decision 9).
 */
function settingsLink(
  join: Extract<ProviderJoin, { via: 'settings' }>,
): JoinResult {
  if (join.provider !== LICHESS) return ok({ kind: 'link' });
  const target = join.targetAccountId;
  return target !== undefined &&
    join.linkAccountId === target &&
    join.sessionAccountId === target
    ? ok({ kind: 'link' })
    : refuse(SIGN_IN_REFUSALS.lichessEmailInUse);
}

/**
 * A join by email at sign-in, denied unless allowed (A1): Lichess never
 * joins by email (R-69, R-83); a verified Google email proves the mailbox
 * of an enabled account and then joins it (R-87); every other provider, or
 * a source with none, is refused. A disabled account is left exactly as it
 * is (R-80).
 */
function emailJoin(join: Extract<ProviderJoin, { via: 'email' }>): JoinResult {
  if (join.provider === LICHESS)
    return refuse(SIGN_IN_REFUSALS.lichessEmailInUse);
  if (join.provider !== GOOGLE || join.emailVerified !== true)
    return refuse(SIGN_IN_REFUSALS.joinRefused);
  if (join.account === undefined || isDisabled(join.account))
    return refuse(SIGN_IN_REFUSALS.joinRefused);
  return ok({ kind: 'proveEmail', accountId: join.account.id });
}

/**
 * May a provider identity join an existing account, and how? A plain
 * sign-in by a signed-in person is a join by email too: only a settings
 * link carries the account to link in its OAuth state.
 */
export function decideProviderJoin(join: ProviderJoin): JoinResult {
  return join.via === 'settings' ? settingsLink(join) : emailJoin(join);
}

/**
 * A session a provider callback opened stands only while that provider's
 * link to the account does (#272): a proof of the email or an unlink may
 * have ended it after the callback found it.
 */
export function providerSessionStands(
  provider: string,
  linkedProviders: readonly string[],
): boolean {
  return linkedProviders.includes(provider);
}

/** How a provider link ended: a proof of the email (R-87), or an unlink. */
export type LinkEnd = 'proof' | 'unlink';

/**
 * Does ending this link leave the browser the Lichess-disconnected notice
 * (R-90)? Only a Lichess link a proof of the email ended: an unlink from
 * settings is the person's own doing.
 */
export function leavesLichessNotice(
  provider: string,
  endedBy: LinkEnd,
): boolean {
  return provider === LICHESS && endedBy === 'proof';
}

/**
 * Does settings tell `accountId` that Lichess was disconnected for its
 * security (R-90)? Only with the browser's notice for this account, and
 * only while Lichess is not linked again.
 */
export function showsLichessNotice(notice: {
  readonly noticeFor: string | undefined;
  readonly accountId: string;
  readonly linkedProviders: readonly string[];
}): boolean {
  return (
    notice.noticeFor === notice.accountId &&
    !notice.linkedProviders.includes(LICHESS)
  );
}
