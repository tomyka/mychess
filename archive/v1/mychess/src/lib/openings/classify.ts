export type Opening = { code: string; name: string; moves: string[] };

function normalize(san: string): string {
  return san.replace(/[+#]$/, '');
}

/**
 * Returns the entry whose move sequence is the longest exact prefix match
 * of `sanMoves`, or null if nothing matches. Comparison ignores trailing
 * check/mate annotations.
 */
export function detectOpening(sanMoves: string[], openings: Opening[]): { code: string; name: string } | null {
  const target = sanMoves.map(normalize);
  let best: Opening | null = null;

  for (const opening of openings) {
    if (opening.moves.length === 0 || opening.moves.length > target.length) continue;
    const isPrefix = opening.moves.every((move, i) => normalize(move) === target[i]);
    if (isPrefix && (!best || opening.moves.length > best.moves.length)) best = opening;
  }

  return best ? { code: best.code, name: best.name } : null;
}

/**
 * Lower-cases and strips diacritics, so a query typed on a keyboard without
 * Lithuanian letters still finds them — `siciliska` matches `Siciliška`. It
 * cuts both ways for English names too: `samisch` finds `Sämisch`, `grunfeld`
 * finds `Grünfeld`.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Case- and diacritic-insensitive substring match against the code, the
 * English name, and — when `namesLt` is supplied — the Lithuanian name.
 * Blank query returns [].
 *
 * The Lithuanian table is matched whatever the active locale rather than only
 * under `lt`: matching more can only find openings the user meant, players
 * routinely know the standard English names alongside the Lithuanian ones, and
 * it keeps this function free of any locale argument (GitHub issue #200).
 *
 * `namesLt` is passed in rather than imported, matching how `openings` already
 * arrives here — this module stays independent of the generated data files.
 */
export function searchOpenings(
  query: string,
  openings: Opening[],
  namesLt?: Record<string, string>
): Opening[] {
  const q = fold(query.trim());
  if (!q) return [];
  return openings.filter(
    (o) =>
      fold(o.name).includes(q) ||
      fold(o.code).includes(q) ||
      (namesLt?.[o.code] !== undefined && fold(namesLt[o.code]).includes(q))
  );
}
