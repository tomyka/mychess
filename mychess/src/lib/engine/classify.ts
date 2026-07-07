// mychess/src/lib/engine/classify.ts
export type EngineScore = { cp: number | null; mate: number | null };
export type MoveQuality = 'fine' | 'inaccuracy' | 'mistake' | 'blunder';
export type SwingResult = { swingCp: number; quality: MoveQuality };

const MATE_BASE = 100000;

/**
 * UCI scores are from the perspective of whoever is to move in the analyzed
 * position. Every position this module compares is the position immediately
 * after the PLAYER's own move (book or played), so the opponent is always
 * the one to move next in that position — meaning the raw score is always
 * negated to express it from the player's perspective. Mate scores convert
 * to a large centipawn-equivalent so they compare on the same numeric scale
 * as centipawn scores (a closer mate counts for more than a farther one).
 */
export function toPlayerPerspective(score: EngineScore): number {
  if (score.mate !== null) {
    const sign = score.mate > 0 ? 1 : -1;
    return -(sign * (MATE_BASE - Math.abs(score.mate)));
  }
  return -(score.cp ?? 0) || 0;
}

/**
 * Lichess-style centipawn-loss thresholds. Each boundary belongs to exactly
 * one tier: <=50 fine, <=100 inaccuracy, <=300 mistake, >300 blunder.
 */
export function classifySwing(swingCp: number): MoveQuality {
  if (swingCp > 300) return 'blunder';
  if (swingCp > 100) return 'mistake';
  if (swingCp > 50) return 'inaccuracy';
  return 'fine';
}

/** How much worse (in centipawns, from the player's perspective) the played move was than the book move. */
export function evaluateSwing(bookScore: EngineScore, playedScore: EngineScore): SwingResult {
  const swingCp = toPlayerPerspective(bookScore) - toPlayerPerspective(playedScore);
  return { swingCp, quality: classifySwing(swingCp) };
}
