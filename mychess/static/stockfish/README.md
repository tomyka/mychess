# Stockfish (bundled engine binary)

`stockfish-18-lite-single.js` + `stockfish-18-lite-single.wasm` — the official
"lite, single-threaded" WASM build of Stockfish.js 18.

Source: https://github.com/nmrugg/stockfish.js
Release: https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0
License: GPLv3 — see https://raw.githubusercontent.com/nmrugg/stockfish.js/master/Copying.txt

Loaded at runtime as a standalone Web Worker
(`new Worker('/stockfish/stockfish-18-lite-single.js')`) by
`src/lib/engine/stockfish.ts` — never statically linked into this app's own
code. The single-threaded build was chosen specifically because it requires
no `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` response
headers (unlike the multi-threaded build, which needs `SharedArrayBuffer`),
and is ~7MB instead of >100MB.

Do not edit these files by hand. To update to a newer Stockfish.js release,
re-download both files from that release's assets and replace them here.
