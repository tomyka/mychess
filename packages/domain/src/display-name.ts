import { z } from 'zod';

/** The most characters a display name may have. */
export const DISPLAY_NAME_MAX = 50;

/**
 * The name a player or coach shows to others: trimmed, never blank and at
 * most DISPLAY_NAME_MAX characters.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'A display name cannot be blank.')
  .max(
    DISPLAY_NAME_MAX,
    `A display name has at most ${String(DISPLAY_NAME_MAX)} characters.`,
  );

export type DisplayName = z.infer<typeof displayNameSchema>;
