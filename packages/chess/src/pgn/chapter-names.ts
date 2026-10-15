/** The headers a chapter title is looked for in, in order (ported from v1). */
const TITLE_HEADERS = ['Event', 'White', 'Black'] as const;

/** A header value, trimmed; blank and PGN's "?" placeholder are no value. */
function usable(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed === '?' ? null : trimmed;
}

function countValues(
  games: readonly Readonly<Record<string, string>>[],
  header: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const headers of games) {
    const value = usable(headers[header]);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Each game's chapter name: the first of Event, White and Black whose value
 * no other game in the file shares (exports often stamp every game with the
 * same collection title), or null when none qualifies.
 */
export function chapterNames(
  games: readonly Readonly<Record<string, string>>[],
): (string | null)[] {
  const counts = TITLE_HEADERS.map((header) => countValues(games, header));
  return games.map((headers) => {
    for (const [i, header] of TITLE_HEADERS.entries()) {
      const value = usable(headers[header]);
      if (value !== null && counts[i]?.get(value) === 1) return value;
    }
    return null;
  });
}
