// mychess/src/lib/engine/version.ts
//
// One identity for "which engine produced this number", shared by the writer
// (scripts/eval-positions.ts) and the reader (src/lib/server/position-evals.ts).
// A stored eval stamped with anything else is treated as ABSENT — not as wrong
// data — so changing the net or the search time is safe to ship before any
// backfill has run.
//
/**
 * How long the precompute job searches each position.
 *
 * 150ms, not 400ms: the repertoire library turned out to hold ~31k positions, so
 * 400ms each was three hours of engine time, and the bar is a glance signal —
 * one decimal, a coloured split, no lines. Both settings reach a depth whose
 * evaluation agrees to well within the tenth of a pawn the bar actually shows.
 * Raise it if the number ever needs to mean more than "who is better".
 */
export const SEARCH_MOVETIME_MS = 150;

/**
 * Identity of the evaluation, stamped on every row and checked on every read.
 * Derived from the search time rather than written out, so the writer and the
 * reader cannot disagree about what a stored number means: change
 * SEARCH_MOVETIME_MS and every existing row becomes "no eval" (not "wrong
 * eval") until the job re-runs. Bump the prefix when the binary changes.
 */
export const ENGINE_ID = `sf18-lite-single@${SEARCH_MOVETIME_MS}ms`;
