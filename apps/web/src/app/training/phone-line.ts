// The line so far as a phone shows it (#381): it wraps, so it keeps only
// the last few full moves, starting at a move number after "…", never
// mid-move. The whole line stays in the accessible text (LineSoFar).
import { lineText } from '@mychess/chess';

/** Full moves a phone shows. */
export const PHONE_MOVES = 6;

/**
 * `sans` written as `lineText` writes them, cut to the last `keep` full
 * moves: "… 2. d4 d5 3. Nc3 …". A line that fits is written whole.
 */
export function phoneLine(
  sans: readonly string[],
  whiteFirst: boolean,
  keep = PHONE_MOVES,
): string {
  const offset = whiteFirst ? 0 : 1;
  const lastMove = Math.floor((sans.length - 1 + offset) / 2);
  const cut = 2 * Math.max(0, lastMove - keep + 1) - offset;
  return lineText(sans, whiteFirst, Math.max(0, cut));
}
