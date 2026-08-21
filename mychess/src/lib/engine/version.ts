// mychess/src/lib/engine/version.ts
//
// One identity for "which engine produced this number", shared by the writer
// (scripts/eval-positions.ts) and the reader (src/lib/server/position-evals.ts).
// A stored eval stamped with anything else is treated as ABSENT — not as wrong
// data — so changing the net or the search time is safe to ship before any
// backfill has run.
//
// Bump this whenever the engine binary or SEARCH_MOVETIME_MS changes.
export const ENGINE_ID = 'sf18-lite-single@400ms';

/** How long the precompute job searches each position. Part of ENGINE_ID above. */
export const SEARCH_MOVETIME_MS = 400;
