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
 * True when a display name is missing — i.e. safe to overwrite with the
 * player's real name. The literal "Guest" used to count as a placeholder too,
 * for profiles the removed guest-auth flow created; those rows were purged in
 * #90, and a real player who chooses "Guest" as their name gets to keep it.
 */
export function isPlaceholderName(displayName: string | null | undefined): boolean {
  return (displayName ?? '').trim() === '';
}
