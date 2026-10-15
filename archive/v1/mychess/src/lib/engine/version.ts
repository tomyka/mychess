// mychess/src/lib/engine/version.ts
//
// The engine build, in one place (#127). The `.js` bootstrap and the `.wasm`
// binary share a stem, and the bootstrap locates the wasm by basename — so
// swapping the build means dropping `<stem>.js` and `<stem>.wasm` into
// static/stockfish/ and changing `ENGINE_BASENAME` here, nothing else.
//
// This module exists because "in one place" was previously only a comment:
// the stem was declared in `engine.svelte.ts` and *also* hardcoded into
// `analyzeGame.ts`, so a swap that edited one left the other loading the old
// binary — a half-applied swap that still resolves, because the old files are
// what the service worker already has cached.
//
// The precompute job that used to pin its stored evals to a build stamp is
// gone (see "retire the precompute job and its daily sweep"), so the basename
// is now genuinely all that identifies the build; nothing downstream has to
// be re-run when it changes.

export const ENGINE_BASENAME = 'stockfish-18-lite-single';

// The URL fragment tells the emscripten bootstrap where to find the .wasm
// binary. A trailing `,worker` marks a load as a *nested* worker spawned by an
// already-running engine (used internally by multi-threaded builds) — the
// bootstrap's top-level dispatch short-circuits on that marker and never wires
// up `onmessage` or loads the engine, so a handshake sent to it silently goes
// nowhere. Both callers here are top-level loads, so neither passes a suffix.
export const ENGINE_URL = `/stockfish/${ENGINE_BASENAME}.js#${ENGINE_BASENAME}.wasm`;
