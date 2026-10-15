import { z } from 'zod';

/** The most characters a display name may have. */
export const DISPLAY_NAME_MAX = 50;

/**
 * The name a player or coach shows to others: trimmed, never blank and at
 * most DISPLAY_NAME_MAX characters. Issue messages are message-catalogue
 * keys, not user-visible text.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'displayName.blank')
  .max(DISPLAY_NAME_MAX, 'displayName.tooLong');

export type DisplayName = z.infer<typeof displayNameSchema>;
