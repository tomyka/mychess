// mychess/src/lib/engine/version.ts
//
// Which Stockfish build the browser worker loads. One place, because the file
// stem is shared by the .js bootstrap and the .wasm binary beside it — the
// bootstrap locates the wasm by basename.
//
// This file used to also carry the identity stamped on precomputed evaluations
// (`ENGINE_ID`) and the search time that job used. Both went with the job
// itself (#132): the engine now runs only in explore mode, on the position in
// front of the player, and nothing is stored.

/**
 * The engine build. Swapping it in (#127) is a config change: drop `<stem>.js`
 * and `<stem>.wasm` into `static/stockfish/` and change `basename` here.
 */
export const ENGINE = {
	/** File stem under `static/stockfish/`, shared by the .js and the .wasm. */
	basename: 'stockfish-18-lite-single'
} as const;
