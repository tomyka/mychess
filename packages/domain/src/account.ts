import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { displayNameSchema } from './display-name';

/** The site's languages: Lithuanian first (R-1). */
export const LOCALES = ['lt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** A new account's language until onboarding picks one (R-1). */
export const DEFAULT_LOCALE: Locale = 'lt';

/** Commercial levels; everything is free in the MVP (R-3, R-70). */
export const ENTITLEMENTS = ['free'] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

/** Every new account's entitlement (R-70). */
export const DEFAULT_ENTITLEMENT: Entitlement = 'free';

/** Message-catalogue keys for account refusals; the UI translates them. */
export const ACCOUNT_REFUSALS = {
  emailInvalid: 'account.emailInvalid',
  deleteNameMismatch: 'account.deleteNameMismatch',
  deleteEmailMismatch: 'account.deleteEmailMismatch',
  localeInvalid: 'account.localeInvalid',
} as const;

export interface AccountRefusal {
  readonly reason: (typeof ACCOUNT_REFUSALS)[keyof typeof ACCOUNT_REFUSALS];
}

/** One signed-in person, as the database hands it over (parsed at the edge). */
export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  // Has the person proved they hold the mailbox (a magic link or a
  // verified Google email)? A Lichess sign-up has not (R-87).
  emailVerified: z.boolean(),
  // Loose on read: a Google or Lichess prefill may be blank or longer than
  // DISPLAY_NAME_MAX until onboarding sets a name through profileSchema.
  displayName: z.string(),
  locale: z.enum(LOCALES),
  entitlement: z.enum(ENTITLEMENTS),
  admin: z.boolean(),
  disabledAt: z.date().nullable(),
  onboardedAt: z.date().nullable(),
  // When Coach mode was switched on (R-11, R-13); null while it is off.
  coachSince: z.date().nullable(),
  createdAt: z.date(),
});
export type Account = z.infer<typeof accountSchema>;

/** The name and language a person sets at onboarding and in settings. */
export const profileSchema = z.object({
  displayName: displayNameSchema,
  locale: z.enum(LOCALES, ACCOUNT_REFUSALS.localeInvalid),
});
export type Profile = z.infer<typeof profileSchema>;

const emailSchema = z.email();

/**
 * The one form of an email an Account is keyed by: NFKC, trimmed, lowercase.
 * Anything that is not a single plain address is refused, so look-alikes
 * never become a second account (security item 6).
 */
export function canonicalEmail(raw: string): Result<string, AccountRefusal> {
  const folded = raw.normalize('NFKC').trim().toLowerCase();
  return emailSchema.safeParse(folded).success
    ? { ok: true, value: folded }
    : { ok: false, refusal: { reason: ACCOUNT_REFUSALS.emailInvalid } };
}

/** Has the account been through the onboarding screen (R-81)? */
export function isOnboarded(account: Account): boolean {
  return account.onboardedAt !== null;
}

/** Has an Admin disabled the account (R-80)? It then opens no session. */
export function isDisabled(account: Account): boolean {
  return account.disabledAt !== null;
}

/**
 * Has the mailbox been proven (R-87)? mychess mails only a proven address:
 * an account a Lichess sign-up created names an address nobody proved.
 */
export function hasProvenEmail(account: Account): boolean {
  return account.emailVerified;
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

const refuse = (
  reason: AccountRefusal['reason'],
): Result<undefined, AccountRefusal> => ({ ok: false, refusal: { reason } });

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
  if (account.onboardedAt === null)
    return sameEmail(account.email, typed)
      ? { ok: true, value: undefined }
      : refuse(ACCOUNT_REFUSALS.deleteEmailMismatch);
  return sameName(account.displayName, typed)
    ? { ok: true, value: undefined }
    : refuse(ACCOUNT_REFUSALS.deleteNameMismatch);
}

/** What an entitlement allows a coach to have. */
export interface EntitlementLimits {
  readonly coachPlayers: number;
  readonly coachGroups: number;
}

const LIMITS: Record<Entitlement, EntitlementLimits> = {
  free: { coachPlayers: 30, coachGroups: 10 },
};

/** What an entitlement allows (R-70); S4 enforces the coach limits. */
export function entitlementLimits(entitlement: Entitlement): EntitlementLimits {
  return LIMITS[entitlement];
}
