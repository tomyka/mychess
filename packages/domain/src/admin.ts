import type { Result } from '@mychess/chess';
import type { Account } from './account';

/** The audited Admin actions (R-72, R-80); one audit row each. */
export const ADMIN_ACTIONS = ['grant-admin', 'disable-account'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** Message-catalogue keys for Admin refusals; the CLI prints them. */
export const ADMIN_REFUSALS = {
  accountNotFound: 'admin.accountNotFound',
  alreadyDisabled: 'admin.alreadyDisabled',
} as const;

export interface AdminRefusal {
  readonly reason: (typeof ADMIN_REFUSALS)[keyof typeof ADMIN_REFUSALS];
}

/**
 * An account is disabled once (R-80): disabling it again would only add a
 * second audit row and move the disable time.
 */
export function canDisable(account: Account): Result<undefined, AdminRefusal> {
  // Not through isDisabled: account-lifecycle imports this module. B2 of
  // #267 replaces canDisable with decideDisable and deletes this function.
  return account.disabledAt !== null
    ? { ok: false, refusal: { reason: ADMIN_REFUSALS.alreadyDisabled } }
    : { ok: true, value: undefined };
}
