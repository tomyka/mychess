# Stockfish engine eval sidebar

## Problem

The Practice page (`src/routes/(player)/practice/[repertoire_id]/+page.svelte`) has no way to see how good a position actually is — only whether a move matched the book line. A player wants a quick, always-available engine sanity check of the current position, without it functioning as an answer key for the quiz itself.

## Goals

- Show a Stockfish evaluation of the current board position on the Practice page only.
- Desktop: a number + small vertical eval bar in the existing right-hand sidebar.
- Mobile: a number + a Lichess-style move list (`1. e4 e5 2. Nf3 Nc6...`) below the existing move-nav row (see `docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md`'s sibling feature, the mobile move-nav added just before this one).
- Eval always reflects "current position" only — no per-ply eval history, no engine best-move/line display (would spoil later book moves in the same variation).
- Runs continuously in the background, always on, no toggle.
- Client-side only (Web Worker + WASM) — no server/API changes, no new DB tables.

## Non-goals

- No engine best-move suggestion or PV line display — the quiz's whole point is finding the move yourself; only the resulting position's evaluation is shown, after a move (yours or an auto-played opponent reply) has actually landed.
- No per-ply eval history/graph — only the live current position.
- No multi-threaded engine, no COOP/COEP header changes — single-threaded WASM only.
- No engine on the drill, time-trial, or settings-preview boards — Practice page only.
- No toggle/settings to disable it — always on when Practice is open.

## Library

Stockfish 18, "lite single-threaded" WASM build from the `stockfish` npm package (`stockfish@18.0.8`, files `bin/stockfish-18-lite-single.js` + `bin/stockfish-18-lite-single.wasm`, confirmed present in that package version). This is the build the Stockfish.js maintainers recommend for browser use without cross-origin-isolation headers — no server config changes needed, matching the existing Vercel deployment as-is.

**Not** added as an npm dependency — the full `stockfish` package is 167MB unpacked across every build variant (multi-threaded, asm.js, etc.) and ships a Node-specific `postinstall.js`/CLI that doesn't fit this static-asset use case. Instead, the two needed files (~7.3MB total) are committed directly into `static/stockfish/stockfish-18-lite-single.js` and `static/stockfish/stockfish-18-lite-single.wasm`, served as-is by SvelteKit's static file handling — no bundler involvement, matching how lichess.org/chess.com embed the same files.

**License**: Stockfish.js is GPLv3 (`Copying.txt` in the npm package). Noting this since the repo doesn't otherwise track dependency licensing — not a blocker, just a fact worth having on record.

## Architecture

### `static/stockfish/` (new, binary assets)

The two engine files, copied in verbatim. Loaded as a dedicated Web Worker via:

```js
new Worker('/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm,worker');
```

The `#filename.wasm,worker` URL hash is this build's own convention for "run in worker mode, and here's where to find the wasm binary relative to origin" — confirmed by reading the unminified control flow in the shipped file.

### `src/lib/engine/uci.ts` (new, pure logic — colocated `uci.test.ts`)

No Worker, no WASM — pure string-in/value-out functions, fully unit-testable:

- `parseInfoLine(line: string): { depth: number; cp?: number; mate?: number } | null` — extracts the latest `score cp X` / `score mate X` and `depth` from a raw UCI `info ...` line; `null` if the line isn't a scored `info` line (e.g. it's a `bestmove` line, or an `info string ...` line, or missing `score`).
- `toWhiteRelative(score: { cp?: number; mate?: number }, sideToMove: 'w' | 'b'): { cp?: number; mate?: number }` — UCI scores are relative to whoever's turn it is in the position that was analyzed; negates when `sideToMove === 'b'` so the result always means "positive = good for White," matching the chess.com/Lichess convention regardless of board orientation.
- `sideToMoveFromFen(fen: string): 'w' | 'b'` — reads the FEN's own side-to-move field (small helper, avoids instantiating a full `Chess` object just for this).
- `formatEval(score: { cp?: number; mate?: number }): string` — `+0.35`, `-1.20`, `0.00`, `M4`, `-M6`. Mate sign follows the same White-positive convention as `cp`.
- `evalBarWhiteFraction(score: { cp?: number; mate?: number }): number` — 0..1, how much of the vertical bar should be "White" — a simple linear clamp (e.g. `cp` scaled over ±500 to ±100%, full 100%/0% for mate in the mating side's favor), not a win-probability curve. Good enough for a quick sanity check, not a serious analysis tool.

### `src/lib/components/EngineEval.svelte` (new — Worker/IO wrapper, manually verified, not unit-tested)

Props: `fen: string`. Owns the Worker's entire lifecycle:

- `onMount`: spawn the Worker, send `uci`, wait for a line containing `uciok`, send `isready`, wait for `readyok`, mark ready.
- A `$effect` on `fen`: once ready, send `stop`, then `position fen <fen>`, then `go movetime 400`. The fixed 400ms budget keeps response latency predictable regardless of position complexity (vs. a fixed depth, which can vary widely in wall-clock time). `stop` is sent unconditionally before every new position — safe even if nothing is currently searching — so a burst of rapid `fen` changes (e.g. the practice page's autoplay intro stepping through several plies in quick succession) never leaves a stale search's result about to overwrite a newer one.
- `onmessage`: parse every line through `parseInfoLine`; on a match, convert + format it and update the displayed eval immediately (so the number visibly "settles" over the 400ms as depth increases — no need to wait for `bestmove`).
- `onDestroy`: `postMessage('quit')` then `terminate()`.
- Worker construction wrapped in try/catch; a WASM-unsupported browser or a failed asset load just leaves the eval UI hidden (a small `engineFailed` flag) — Practice must keep working with zero engine regardless.

### Practice page changes (`+page.svelte`)

- Desktop sidebar: `<EngineEval fen={displayFen} />` rendered as number + vertical bar, inside the existing `hidden lg:block` sidebar card area.
- Mobile: `<EngineEval fen={displayFen} />` rendered as just the number (compact), plus a new plain-text move list built from `quizSteps.slice(0, quizIdx)` (or `reviewIdx` when reviewing) formatted the same way `moveSequenceLabel` (`src/lib/mastery/variations.ts`) already formats move sequences elsewhere in this codebase — reusing that existing helper rather than re-deriving move-number/ellipsis logic.
- Both consume the SAME `displayFen` the mobile move-nav (previous feature) already computes — reviewing an earlier ply via `◀`/`⏮` shows that ply's eval too, with no separate special-casing: there's no distinct "before your move" board state in this codebase to begin with, since `boardFen`/`displayFen` only ever changes once a move has actually landed.

## Error handling / edge cases

- Worker fails to spawn, or WASM isn't supported: eval UI hides itself silently; no error surfaced to the player, no crash.
- Engine slower than 400ms to respond on a very first cold position (WASM instantiation): the eval area shows a lightweight loading state (e.g. "…") until the first `info` line arrives.
- Rapid position changes (autoplay stepping through several plies before the player's first real input): each new `fen` sends `stop` + a fresh `position`/`go`, so only the last-requested position's result is ever displayed — no stale eval flashing on top of a newer position.
- Practice page navigated away from / component unmounted mid-search: `onDestroy` tears down the Worker immediately regardless of search state.

## Testing

- `uci.test.ts`: `parseInfoLine` against real sample UCI lines (cp score, mate score, no-score info lines, `bestmove` lines, malformed input); `toWhiteRelative` for both `cp` and `mate`, both side-to-move values; `sideToMoveFromFen` against a handful of real FENs (including one with Black to move); `formatEval` covering positive/negative/zero cp and positive/negative mate; `evalBarWhiteFraction` at the clamp boundaries and midpoint.
- `EngineEval.svelte` and the real Worker/WASM round-trip: manually verified in a real browser (Practice page, checking the number updates after each move and after mobile move-nav review, and that the page still works if the engine is blocked/fails). Not covered by `vitest`/jsdom, consistent with this repo's existing convention for I/O-touching code.

## Rollout

- `static/stockfish/*` committed to the repo (~7.3MB) — a one-time page-weight increase for Practice page visitors, cached by the browser afterward.
- No migration, no new environment variables, no server route changes.
