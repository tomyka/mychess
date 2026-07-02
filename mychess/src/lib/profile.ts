/** Placeholder display name assigned to anonymous guest profiles. */
export const GUEST_DISPLAY_NAME = 'Guest';

/**
 * Builds a display name from a player's first and last name.
 * Returns the trimmed "First Last" (or whichever part is present), or null
 * when neither name is set.
 */
export function fullNameOrNull(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const full = [firstName, lastName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return full || null;
}

/**
 * True when a display name is missing or is the guest placeholder — i.e. safe
 * to overwrite with the player's real name.
 */
export function isPlaceholderName(displayName: string | null | undefined): boolean {
  const name = (displayName ?? '').trim();
  return name === '' || name === GUEST_DISPLAY_NAME;
}
