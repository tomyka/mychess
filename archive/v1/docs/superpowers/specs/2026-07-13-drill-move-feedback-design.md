# Drill Move Feedback — Design

## Purpose

Today Drill mode only tells the player right/wrong by comparing the played SAN against the single due repertoire move — a green star badge for correct, red "Wrong move! Chain broken!" text for anything else. There's no distinction between "you played a different line you also know" and "you played a real engine mistake" vs. "a reasonable alternative that just isn't your prep." This adds a 3-state result — ★ book move, ✓ off-book but not a mistake, ✗ off-book mistake — using Stockfish to tell the two off-book cases apart, so feedback reflects actual chess quality instead of a binary pass/fail against one memorized line.

## Scope

- Drill mode only (`/drill`). Practice and Time Trial keep today's binary feedback — Time Trial in particular doesn't fit engine-analysis latency well (same reasoning that already excluded it from the Master-mode Stockfish feature); this can be revisited as a separate initiative later.
- Board interaction stays fully dynamic — no confirmation button. Moves are validated the instant a piece is dropped, exactly as today.
- Repertoires can already have multiple valid moves at one position: PGN variations are parsed and stored as multiple `moves` rows sharing a `from_position` (`src/lib/pgn/parser.ts`, `moves` table unique constraint is `(repertoire_id, from_position, san)`, not `(repertoire_id, from_position)`). Any of those book moves scores ★, regardless of which specific move the SRS card due today happens to be testing — SRS already schedules each move-edge independently (`reviews.move_id`), so every branch keeps getting its own review cadence with no new scheduling logic.

## Architecture: reuses the existing Master-mode engine stack, wired into Drill

`src/lib/engine/stockfish.ts` (lazy client-side WASM Stockfish, module-level singleton, one search at a time) and `src/lib/engine/classify.ts` (`toPlayerPerspective` + `classifySwing` → `fine`/`inaccuracy`/`mistake`/`blunder`, lichess-style centipawn-loss thresholds) already exist from the Master-mode Stockfish evaluation feature and are reused unchanged — no new engine or classification logic. They're currently only imported in `/master/[repertoire_id]/+page.svelte`; this feature imports the same two modules into `/drill/+page.svelte`.

Mapping to the two off-book icons: `fine`/`inaccuracy` → ✓. `mistake`/`blunder` → ✗.

## Data flow

1. **Loader change** (`/drill/+page.server.ts`): alongside today's flat queue of due moves, also fetch a `position_id → san[]` map covering every repertoire move sharing each due move's `from_position`. A small pure helper in `src/lib/repertoire.ts` builds this map from the fetched `moves` rows and exposes an `isBookMove(bookSans: string[], playedSan: string): boolean` check.
2. **On piece drop** (`handleMove` in `/drill/+page.svelte`):
   - Played SAN is in the current position's book-move set → **★**. Same instant handling as today's correct path (star badge, chain increments), no engine call.
   - Otherwise (off-book):
     a. Immediately show a neutral "checking…" marker on the destination square — no button, no lock, the move is already accepted on the board — and reveal the due book move (text/highlight) right away, since that doesn't need to wait on Stockfish.
     b. Record the review outcome as wrong for the due move **now**, same timing as today — the forced retry below (✗ only) is a UI/learning aid afterward, it does not change or delay SRS bookkeeping.
     c. Apply the due book move and the played move to the pre-move FEN (`chess.js`) → `bookFen` / `playedFen`.
     d. Call `evaluatePosition(bookFen, 800)` and `evaluatePosition(playedFen, 800)` in parallel (same pattern and movetime Master mode already uses), normalize to player perspective, compute swing, classify.
     e. Swap the neutral marker to ✓ or ✗ once resolved (~1.6s later).
     f. **✓ path**: chain already broke (it wasn't the book move); reveal stays visible; advance to the next queued card — same flow as today's wrong-move handling, just with a ✓ icon and engine-informed framing instead of plain red text.
     g. **✗ path**: board reverts to the pre-move position (already happens today) and does **not** advance. An inline prompt ("Not quite — play the book move to continue") stays until the player plays the correct SAN from that position; only then does the queue advance. This is new behavior — today's flow advances regardless of guess quality.
   - If either `evaluatePosition` call rejects (engine unavailable/blocked), skip classification and fall back to today's plain wrong-move behavior (no ✓/✗, advance immediately) — matches the Master-mode convention of failing silently rather than blocking the session.

## UI

- New square-overlay icons on `ChessBoard`, alongside the existing star: a neutral pending marker (small pulsing dot, same overlay mechanism the star already uses), a ✓ badge, and a ✗ badge.
- Reveal of the due book move (e.g. "Book move: Nf3") appears immediately for any off-book move, before the icon resolves — never blocked on the engine.
- ✗ retry prompt stays visible until the correct SAN is played from that position.

## Out of scope

- Practice mode, Time Trial mode.
- Any change to piece/board visuals (separate initiative, already decided against for now).
- A settings toggle for this feedback.
- Precomputing/caching book-move Stockfish evals ahead of time to cut latency — live dual-eval per off-book move (as Master mode already does) is accepted for now; a candidate follow-up if it feels slow in practice.
- Gamification (badges/quests/XP/streaks) — untouched, still fires at session end via the existing `api/drill` endpoint.

## Testing

- New unit tests for the book-move-set helper(s) added to `src/lib/repertoire.ts` (building the `position_id → san[]` map, `isBookMove` membership check) — colocated `repertoire.test.ts`, no engine needed.
- `classify.ts` / `stockfish.ts` already fully covered by existing tests from the Master-mode feature — no changes needed there.
- `/drill/+page.svelte` wiring: no existing test file for this page today (matches `/master`'s own convention) — verified manually in the browser, specifically: a book move (★), an off-book-but-fine move (✓, advances), an off-book mistake (✗, forces retry until the book move is played), and the engine-unavailable fallback (blocking the WASM worker in dev tools and confirming it degrades to today's plain wrong-move behavior).
- `npm run check` must add no new type errors beyond the known baseline; full `npm test` run before commit.
