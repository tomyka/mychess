import { z } from 'zod';

/** The most characters a display name may have. */
export const DISPLAY_NAME_MAX = 50;

/** Message-catalogue keys for the refusals; the UI translates them. */
export const DISPLAY_NAME_ISSUES = {
  blank: 'displayName.blank',
  tooLong: 'displayName.tooLong',
} as const;

/**
 * The name an Account shows to others: trimmed, never blank and at most
 * DISPLAY_NAME_MAX characters.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, DISPLAY_NAME_ISSUES.blank)
  .max(DISPLAY_NAME_MAX, DISPLAY_NAME_ISSUES.tooLong);

export type DisplayName = z.infer<typeof displayNameSchema>;
