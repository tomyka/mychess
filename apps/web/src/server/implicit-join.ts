import { isDisabled, type Account } from '@mychess/domain';
import { JOIN_REFUSED, LICHESS_EMAIL_IN_USE } from '../lib/sign-in-errors';
import type { Provider } from '../lib/providers';

const LICHESS: Provider = 'lichess';
const GOOGLE: Provider = 'google';

/**
 * A provider identity about to join the account with its email at sign-in,
 * with no link from settings behind it.
 */
export interface ImplicitJoin {
  readonly providerId: string | undefined;
  /** What the provider says of the email; only `true` counts. */
  readonly emailVerified: unknown;
  /** The account with that email, as the database holds it. */
  readonly account: Account | undefined;
}

export type JoinDecision =
  | { readonly kind: 'refuse'; readonly code: string }
  | { readonly kind: 'proveEmail'; readonly accountId: string };

const refuse = (code: string): JoinDecision => ({ kind: 'refuse', code });

/**
 * Denied unless allowed: Lichess never joins by email (R-69, R-83); a
 * verified Google email proves the mailbox of an enabled account and then
 * joins it (R-87); every other provider, or a source with none, is refused.
 * A disabled account is left exactly as it is (R-80).
 */
export function implicitJoin(join: ImplicitJoin): JoinDecision {
  if (join.providerId === LICHESS) return refuse(LICHESS_EMAIL_IN_USE);
  if (join.providerId !== GOOGLE || join.emailVerified !== true)
    return refuse(JOIN_REFUSED);
  if (join.account === undefined || isDisabled(join.account))
    return refuse(JOIN_REFUSED);
  return { kind: 'proveEmail', accountId: join.account.id };
}
