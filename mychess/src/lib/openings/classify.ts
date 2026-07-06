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

/** Case-insensitive substring match against code and name. Blank query returns []. */
export function searchOpenings(query: string, openings: Opening[]): Opening[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return openings.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
}
