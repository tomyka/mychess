import { ok, refuse, type Result } from '@mychess/chess';
import {
  ACCOUNT_REFUSALS,
  canonicalEmail,
  hasProvenEmail,
  type Account,
  type AccountRefusal,
  type Locale,
  type Profile,
} from './account';
import { ADMIN_REFUSALS, type AdminRefusal } from './admin';

/**
 * The life of an Account, as pure decisions: where it stands (its stage)
 * and which transitions it may take. db applies a decided change on the
 * locked row; web gates on the stage. Client-safe: no server import.
 */

/** Has the account been through the onboarding screen (R-81)? */
export function isOnboarded(account: Account): boolean {
  return account.onboardedAt !== null;
}

/** Has an Admin disabled the account (R-80)? It then opens no session. */
export function isDisabled(account: Pick<Account, 'disabledAt'>): boolean {
  return account.disabledAt !== null;
}

/** Where an Account is in its life. */
export type AccountStage = 'notOnboarded' | 'onboarded' | 'disabled';

/**
 * The account's stage. Disabled wins over everything (R-80: no way in);
 * otherwise it is onboarded once it has been through onboarding (R-81).
 */
export function accountStage(
  account: Pick<Account, 'onboardedAt' | 'disabledAt'>,
): AccountStage {
  if (isDisabled(account)) return 'disabled';
  return account.onboardedAt === null ? 'notOnboarded' : 'onboarded';
}

/** What the person types to confirm deleting their account. */
export type DeleteConfirmation = 'displayName' | 'email';

/**
 * Deletion is confirmed by typing the display name (R-82); an account that
 * has not been through onboarding has no name of its own yet, so it types
 * its email address instead (R-86).
 */
export function deleteConfirmation(
  account: Pick<Account, 'onboardedAt'>,
): DeleteConfirmation {
  return account.onboardedAt === null ? 'email' : 'displayName';
}

/** What deciding a deletion needs to know about the account. */
export type DeletableAccount = Pick<
  Account,
  'displayName' | 'email' | 'onboardedAt'
>;

/**
 * Only what deciding a deletion needs, so a page hands a client component
 * no more of the account than that.
 */
export function deletableAccount(account: DeletableAccount): DeletableAccount {
  return {
    displayName: account.displayName,
    email: account.email,
    onboardedAt: account.onboardedAt,
  };
}

const sameEmail = (email: string, typed: string): boolean => {
  const canonical = canonicalEmail(typed);
  return canonical.ok && canonical.value === email;
};

const sameName = (displayName: string, typed: string): boolean =>
  displayName.trim() !== '' && typed.trim() === displayName;

/**
 * Deletion is confirmed by typing the display name exactly (R-82); a blank
 * name can never be typed, so it never confirms one. An account that has
 * not been through onboarding has no name of its own yet, so it confirms
 * with its email address instead, in its canonical form (R-86).
 */
export function canDelete(
  account: DeletableAccount,
  typed: string,
): Result<undefined, AccountRefusal> {
  if (deleteConfirmation(account) === 'email')
    return sameEmail(account.email, typed)
      ? ok()
      : refuse(ACCOUNT_REFUSALS.deleteEmailMismatch);
  return sameName(account.displayName, typed)
    ? ok()
    : refuse(ACCOUNT_REFUSALS.deleteNameMismatch);
}

/** Keys for lifecycle refusals; web answers both with a redirect, never text. */
export const LIFECYCLE_REFUSALS = {
  alreadyOnboarded: 'lifecycle.alreadyOnboarded',
  accountClosed: 'lifecycle.accountClosed',
} as const;

export type LifecycleRefusalReason =
  (typeof LIFECYCLE_REFUSALS)[keyof typeof LIFECYCLE_REFUSALS];

export interface OnboardingRefusal {
  readonly reason: LifecycleRefusalReason;
}

/** What onboarding writes: the profile, stamped with when it happened. */
export interface Onboarding {
  readonly profile: Profile;
  readonly onboardedAt: Date;
}

const ONBOARDING_REFUSALS: Record<
  Exclude<AccountStage, 'notOnboarded'>,
  LifecycleRefusalReason
> = {
  disabled: LIFECYCLE_REFUSALS.accountClosed,
  onboarded: LIFECYCLE_REFUSALS.alreadyOnboarded,
};

/**
 * Onboarding happens once (R-81). An account gone or disabled has no way
 * in (R-80), whether or not it was onboarded; an onboarded one is done.
 */
export function decideOnboarding(
  account: Account | undefined,
  profile: Profile,
  now: Date,
): Result<Onboarding, OnboardingRefusal> {
  if (account === undefined) return refuse(LIFECYCLE_REFUSALS.accountClosed);
  const stage = accountStage(account);
  return stage === 'notOnboarded'
    ? ok({ profile, onboardedAt: now })
    : refuse(ONBOARDING_REFUSALS[stage]);
}

/**
 * An account is disabled once (R-80): disabling it again would only add a
 * second audit row and move the disable time.
 */
export function decideDisable(
  account: Account,
  now: Date,
): Result<{ readonly disabledAt: Date }, AdminRefusal> {
  return isDisabled(account)
    ? refuse(ADMIN_REFUSALS.alreadyDisabled)
    : ok({ disabledAt: now });
}

/** A decided deletion: whom to send the confirmation mail (R-82). */
export interface AccountDeletion {
  /** Where the R-82 confirmation goes; null for an unproven email (R-87) or an account already gone. */
  readonly confirmationMail: {
    readonly to: string;
    readonly locale: Locale;
  } | null;
}

/**
 * May the account be deleted on `typed`, and who is told (R-40, R-82, R-86,
 * R-87)? An account already gone has nothing left to confirm or mail.
 */
export function decideDeletion(
  account: Account | undefined,
  typed: string,
): Result<AccountDeletion, AccountRefusal> {
  if (account === undefined) return ok({ confirmationMail: null });
  const confirmed = canDelete(account, typed);
  if (!confirmed.ok) return confirmed;
  return ok({
    confirmationMail: hasProvenEmail(account)
      ? { to: account.email, locale: account.locale }
      : null,
  });
}
