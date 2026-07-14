/** Unions a player's own repertoire ids with those assigned by a coach, de-duplicated. */
export function mergeRepertoireIds(own: string[], assigned: string[]): string[] {
  return [...new Set([...own, ...assigned])];
}

/** One player-turn `moves` row at a shared `from_position` — repertoires can
 * legitimately have more than one book move at the same position (parsed PGN
 * variations), so matching "is this the book move?" means matching *any* of
 * them, not just whichever one a queue happened to pick for this card. */
export type BookMoveEntry = { id: string; san: string };

/** Groups player-turn moves by the position they're played from, so a played
 * SAN can be checked against every book alternative at that position, not
 * just the single move a queue/card happens to be showing. */
export function buildBookMoveMap(
  rows: { id: string; from_position: string; san: string }[]
): Record<string, BookMoveEntry[]> {
  const map: Record<string, BookMoveEntry[]> = {};
  for (const row of rows) {
    (map[row.from_position] ??= []).push({ id: row.id, san: row.san });
  }
  return map;
}

/** Whether `playedSan` matches any book move at this position. */
export function isBookMove(entries: BookMoveEntry[], playedSan: string): boolean {
  return entries.some((e) => e.san === playedSan);
}

/** The specific book move entry (with its own `moves.id`) that `playedSan`
 * matches, if any — needed because Master mode flips *that* move's
 * `move_progress` row to `'correct'`, not necessarily the queued card's. */
export function findBookMove(entries: BookMoveEntry[], playedSan: string): BookMoveEntry | undefined {
  return entries.find((e) => e.san === playedSan);
}
