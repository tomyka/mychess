# Stockfish Move Evaluation — Design

## Purpose

In Learn mode (the SRS-based spaced-repetition training mode), a wrong guess currently only shows "Not quite! Try again..." and, after giving up or answering, "Answer: {book move}" — no sense of *how* wrong the played move was. Adding a real chess engine (Stockfish) lets the feedback tell the player how much worse their move was than the book move, using familiar chess terminology (Inaccuracy/Mistake/Blunder).

## Scope

- Applies only to **Learn mode** (`/learn`). Practice and Time Trial are explicitly out of scope — Time Trial's timed nature doesn't fit engine-analysis latency well, and Practice wasn't requested.
- Only triggers on a **wrong** guess. Correct moves get no engine feedback (matches the existing "Not quite" feedback, which is also wrong-move-only).
- Compares the player's move against the **book/repertoire move**, not the engine's own top choice — repertoire lines are deliberate prep, not necessarily the objectively best move, and the training goal is "did you play what you were supposed to memorize," not "did you play the theoretically optimal move."

## Architecture: client-side WASM, not a server call

Stockfish runs entirely in the browser via WebAssembly, inside a dedicated Web Worker, using the `stockfish` npm package (ships a WASM binary + a JS wrapper speaking the standard UCI protocol over `postMessage`). It is **lazily loaded** — nothing is fetched or initialized until the first wrong guess in a Learn session actually needs an evaluation, so sessions that never trigger it pay no cost.

This was chosen over running Stockfish server-side (a Vercel function) because:
- No backend/infra work — getting a native Stockfish binary running reliably in Vercel's Node runtime is nontrivial, and there is no reason this needs to run anywhere but the browser.
- No network round-trip latency on top of engine think-time.
- Matches how other chess sites (e.g. lichess) do local analysis.

## Data flow

`src/lib/engine/stockfish.ts` — the I/O wrapper (not unit-tested, matches the codebase's convention for I/O-touching modules):
- Module-level singleton: creates the Worker + WASM instance on first call, reused afterward.
- Exposes `evaluatePosition(fen: string, movetimeMs: number): Promise<{ cp: number | null; mate: number | null }>` — sends `position fen <fen>` + `go movetime <movetimeMs>` over UCI, resolves on the `bestmove` line, parsing the last `info ... score cp <n>` or `info ... score mate <n>` seen before it.
- If the worker fails to initialize (blocked, unsupported browser, etc.), the failure is caught once at creation time; `evaluatePosition` rejects, and callers treat that as "no evaluation available" — no retries, no user-visible error.

`src/lib/engine/classify.ts` — pure logic, fully unit-tested with fake engine outputs (no real engine needed for these tests):
- `toPlayerPerspective(score: {cp: number|null; mate: number|null}): number` — UCI scores are from the perspective of whoever is to move in the analyzed position. Both positions evaluated here are always right after the *player's own* move (book or played), so the opponent is always the one to move next — the raw score is unconditionally negated to express it from the player's perspective. Mate scores convert to a large signed centipawn-equivalent (e.g. `(100000 - matePlies) * sign`) so they compare on the same numeric scale as centipawn scores.
- `classifySwing(swingCp: number): 'fine' | 'inaccuracy' | 'mistake' | 'blunder'` — thresholds: `<50` → `fine`, `50–100` → `inaccuracy`, `100–300` → `mistake`, `>300` → `blunder` (lichess-style centipawn-loss convention, already familiar to most chess players).

Call flow on a wrong guess in `/learn/+page.svelte`:
1. Apply the book move's SAN to the pre-move FEN (via `chess.js`, already a project dependency) → `bookFen`. Apply the player's played SAN similarly → `playedFen`.
2. Call `evaluatePosition(bookFen, 800)` and `evaluatePosition(playedFen, 800)` (in parallel).
3. Normalize both to the player's perspective, compute `swing = bookEval - playedEval` (positive = played move was worse).
4. Classify the swing and display.
5. If either evaluation call rejects (engine unavailable), skip the whole feedback line silently.

## UI

In the feedback panel shown after a wrong answer (the existing block with "Answer: {san}" and the Next/Finish button), a new line appears once evaluation resolves:
- A colored label — "Also fine" (gray), "Inaccuracy" (yellow), "Mistake" (orange), "Blunder" (red) — plus the raw swing, e.g. "Blunder (−340cp)".
- While evaluation is in flight, that line shows a small "Evaluating…" spinner instead. This is purely additive: the rest of the feedback panel (the Next button, the correct-move text) is interactive immediately and never blocked waiting on the engine.
- If evaluation ultimately fails or never resolves, the line simply never appears — no error state, no layout shift beyond the line not being there.

## Bundle size

The `stockfish` package and its WASM binary are dynamically imported (`await import('stockfish')`) only inside `stockfish.ts`'s lazy singleton initializer — never part of the main page bundle, never fetched until actually needed.

## Out of scope

- Practice mode, Time Trial mode, or any other training surface.
- Evaluating correct moves.
- Comparing against the engine's own best move (only the book-move comparison, per explicit decision above).
- A settings toggle to disable engine feedback — not requested; if it turns out to be unwanted later, that's a small follow-up.
- Any change to how repertoires are built, imported, or displayed — this is purely additive to the Learn feedback panel.

## Testing

- `src/lib/engine/classify.ts`: full unit tests — perspective normalization (including mate-score conversion), swing calculation, and label thresholds at their boundaries (49/50/99/100/299/300/301cp).
- `src/lib/engine/stockfish.ts`: not unit-tested (I/O wrapper around a Worker/WASM instance), matching the established convention for this codebase's I/O-touching modules (e.g. `fide/download.ts`, `server/pgn-import.ts`).
- `/learn/+page.svelte` wiring: not directly unit-tested (this page has no existing test file today), verified manually in the browser instead.
