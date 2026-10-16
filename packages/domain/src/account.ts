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
  localeInvalid: 'account.localeInvalid',
} as const;

export interface AccountRefusal {
  readonly reason: (typeof ACCOUNT_REFUSALS)[keyof typeof ACCOUNT_REFUSALS];
}

/** One signed-in person, as the database hands it over (parsed at the edge). */
export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  // Loose on read: a Google or Lichess prefill may be blank or longer than
  // DISPLAY_NAME_MAX until onboarding sets a name through profileSchema.
  displayName: z.string(),
  locale: z.enum(LOCALES),
  entitlement: z.enum(ENTITLEMENTS),
  admin: z.boolean(),
  disabledAt: z.date().nullable(),
  onboardedAt: z.date().nullable(),
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

/** Deletion is confirmed by typing the display name exactly (R-82). */
export function canDelete(
  displayName: string,
  typedName: string,
): Result<undefined, AccountRefusal> {
  return typedName.trim() === displayName
    ? { ok: true, value: undefined }
    : { ok: false, refusal: { reason: ACCOUNT_REFUSALS.deleteNameMismatch } };
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
