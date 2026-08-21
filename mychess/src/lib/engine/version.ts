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
 * The engine build, in one place: the file stem everything is loaded by, and the
 * short id that goes into the stored stamp. They are one literal deliberately —
 * swapping the binary means editing both together, so the stamp cannot claim a
 * build that isn't the one running.
 *
 * Swapping in a smaller build (#127) is therefore a config change: drop
 * `<stem>.js`, `<stem>.wasm` and a `<stem>.cjs` copy of the bootstrap into
 * `static/stockfish/`, change both fields here, and re-run
 * `npm run positions:eval`. The `.cjs` copy is what the precompute job spawns —
 * this package is `"type": "module"`, so Node parses the `.js` as ESM and its
 * UMD wrapper fails — and it must keep the same stem, because the wasm sibling
 * is located by basename.
 */
export const ENGINE = {
	/** File stem under `static/stockfish/`, shared by the .js, .cjs and .wasm. */
	basename: 'stockfish-18-lite-single',
	/** Short form used in the stored stamp. Keep it in step with the basename. */
	shortId: 'sf18-lite-single'
} as const;

/**
 * Identity of the evaluation, stamped on every row and checked on every read.
 * Derived rather than written out, so the writer and the reader cannot disagree
 * about what a stored number means: change the build or the search time and
 * every existing row becomes "no eval" (not "wrong eval") until the job re-runs.
 */
export const ENGINE_ID = `${ENGINE.shortId}@${SEARCH_MOVETIME_MS}ms`;
