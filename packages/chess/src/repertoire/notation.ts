// How a line's moves are numbered when written out: `6.` before White's
// move, `6...` before Black's.
import type { Side } from './graph';

/**
 * The number shown before the move `ply` half-moves after a chapter's root:
 * `6.` for White, `6...` for Black. A position key has no move counter, so
 * the count starts from the root (move 1).
 */
export function moveNumber(ply: number, whiteFirst: boolean): string {
  const half = ply + (whiteFirst ? 0 : 1);
  const number = String(Math.floor(half / 2) + 1);
  return half % 2 === 0 ? `${number}.` : `${number}...`;
}

/**
 * `san`, `side`'s move at full move `fullMove`, as players read it alone:
 * "2. Bf4" for White, "5...a6" for Black.
 */
export function numberedMove(
  fullMove: number,
  side: Side,
  san: string,
): string {
  const dots = side === 'black' ? '...' : '. ';
  return `${String(fullMove)}${dots}${san}`;
}

/** Before a line written from past its root: "… 5. a4 Bf5". */
const FROM_LATER = '…';

/**
 * "1. e4 c6 2. d4": a line's moves from a chapter's root as one string, with
 * a number before the first move written and before every White move. From
 * `fromPly` on, it starts with "…" and keeps the root's numbering:
 * "… 2. d4 d5".
 */
export function lineText(
  sans: readonly string[],
  whiteFirst: boolean,
  fromPly = 0,
): string {
  const words = sans.slice(fromPly).map((san, index) => {
    const number = moveNumber(fromPly + index, whiteFirst);
    return index === 0 || !number.endsWith('...') ? `${number} ${san}` : san;
  });
  return (fromPly === 0 ? words : [FROM_LATER, ...words]).join(' ');
}

/** How many moves every line starts with. */
function sharedLength(lines: readonly (readonly string[])[]): number {
  const [first, ...rest] = lines;
  if (first === undefined) return 0;
  let length = 0;
  while (
    length < first.length &&
    rest.every((line) => line[length] === first[length])
  )
    length += 1;
  return length;
}

/**
 * A chapter's trunk: the moves all its lines share, less one so every line
 * keeps at least its last move; none for a lone line.
 */
function trunkLength(lines: readonly (readonly string[])[]): number {
  if (lines.length < 2) return 0;
  const shortest = Math.min(...lines.map((line) => line.length));
  return Math.max(0, Math.min(sharedLength(lines), shortest - 1));
}

/**
 * Each of a chapter's lines (SAN from the chapter root) written from where
 * it leaves the chapter's trunk, numbered from the root: "… 5. a4 Bf5"
 * rather than the whole line from move 1. A lone line is written whole.
 */
export function lineTextsFromTrunk(
  lines: readonly (readonly string[])[],
  whiteFirst: boolean,
): string[] {
  const from = trunkLength(lines);
  return lines.map((sans) => lineText(sans, whiteFirst, from));
}
