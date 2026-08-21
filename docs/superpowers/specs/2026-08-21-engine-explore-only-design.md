# Engine in explore mode only, deliberately activated

Date: 2026-08-21

## Problem

Learn and Practice are drilling surfaces: the player repeats a memorised line.
An evaluation bar on the board's edge is analysis, and analysis is not what
either mode is for — it invites judging the position instead of recalling the
move. Today the bar is always on in both (fed by precomputed `positions.eval_cp`,
issue #126, so no WASM downloads while drilling), and explore mode spawns the
local Stockfish worker automatically the moment the board goes off-book.

The engine belongs in explore mode, and only when the player asks for it.

## Decisions

1. **No eval bar while drilling.** Learn and Practice render the board with no
   bar, no number, and no eval fetch. Pure repetition.
2. **Explore mode gains an engine toggle.** Off by default. Pressing it
   downloads the WASM and shows the bar for the explored position and every ply
   after it. Pressing again tears the worker down and hides the bar.
3. **Activation lasts the visit, in memory only.** Module-level state, so
   leaving and re-entering explore — or navigating Learn → Practice — keeps it
   on. A reload starts off again. No `localStorage`, no profile preference.
4. **The precompute pipeline is removed.** Its only consumer was the drilling
   bar; explore's live engine evaluates whatever position is on screen,
   including the on-book start, so stored evals buy nothing.

Explore mode itself is unchanged: still an overlay inside Learn and Practice,
still reachable from "Explore this position" and from "See why" after a failed
line (#131).

## Behaviour

**Drilling (Learn, Practice).** Board sits alone beside the status strip. No
bar, no engine, no `evals` in the page data.

**Explore, engine off (default).** The two-button control row (Undo / Back to
the line) becomes three, with **⚙ Engine** in the middle. The bar's slot (`w-8` plus the `gap-2` beside it, ~40px) is reserved for as long as explore is active, empty while the engine is off, so
turning it on fills a waiting slot instead of shoving the board sideways
mid-analysis.

**Explore, engine on.** Bar appears in that gutter and evaluates the explored
position and each ply after it, exactly as it does today off-book. Before the
first score, and if the WASM cannot load at all, the bar holds an even 50/50
with a dash — the existing behaviour, unchanged.

## Code changes

`src/lib/engine/engine.svelte.ts`
- add `export const engineEnabled = $state({ on: false })` — an object because a
  module-scope `let` cannot be exported reactively
- add `export function setEngineEnabled(on: boolean)`; `false` calls
  `teardownEngine()`, whose doc comment already describes this caller ("the user
  switched the toggle off") and has never had one

`src/lib/components/EngineToggle.svelte` (new)
- one button, `aria-pressed`, reading and writing `engineEnabled`; label
  "⚙ Engine" / "⚙ Engine on", styled to match its sibling Undo button

`src/lib/components/EvalBar.svelte`
- drop the `bookEval` prop; `ensureEngine()` and `requestIfDue(fen)` become
  unconditional and `score` becomes `engineState.score`
- header comment rewritten: "shown only in explore mode, only after the user
  turns the engine on" replaces "always on, and normally engine-free"

`src/routes/(player)/learn/[repertoire_id]/+page.svelte` and
`src/routes/(player)/practice/[repertoire_id]/+page.svelte` (identical edits)
- render `EvalBar` only while `explore.active && engineEnabled.on`; render a
  `w-8 shrink-0` spacer in its place while explore is active with the engine off
- explore control row `grid-cols-2` → `grid-cols-3`, `EngineToggle` in the middle
- drop `bookEval={data.evals?.[displayFen] ?? null}`

## Removals

The precompute pipeline, consumer-less once the drilling bar is gone:

- `src/lib/server/position-evals.ts` — the whole module (`loadPositionEvals`,
  `fensInPath`); no other callers
- the `loadPositionEvals`/`fensInPath` calls and the returned `evals` in both
  `learn/[repertoire_id]/+page.server.ts` and
  `practice/[repertoire_id]/+page.server.ts`
- `scripts/eval-positions.ts` and `src/lib/engine/stockfishProcess.ts` (the
  script is its only importer)
- the `positions:eval` npm script, and `.github/workflows/eval-positions.yml`
  (the daily sweep added in #130)
- `ENGINE_ID` from `src/lib/engine/version.ts` — the stamp had exactly two users,
  both going — along with `SEARCH_MOVETIME_MS`, which goes with
  `stockfishProcess.ts`; the browser worker has its own `MOVETIME_MS = 400`.
  `ENGINE` stays: the worker loads by `basename`. The file's comments about
  stamping and backfilling shrink to "which build the browser worker loads".

**`positions.eval_cp` / `eval_mate` / `eval_engine` stay.** No migration: the
columns are harmless, the ~31k stored numbers cost nothing, and keeping them
makes reviving the pipeline a code change rather than a backfill.

## Tests

`src/lib/components/EvalBar.test.ts` — the five `bookEval` render cases lose the
prop and seed `engineState.score` instead, as the file's engine-driven cases
already do. They test bar geometry, label, and number placement, not the eval
source, so no coverage is lost.

`src/lib/components/EvalBar.engine.test.ts` — drop the "no spawn when bookEval
is present" assertion; the spawn, handshake, and failure cases stay, now
unconditional. `setEngineEnabled(false)` tearing the worker down is added here,
where the Worker mock already lives.

`src/routes/(player)/learn/[repertoire_id]/learn.test.ts` — the existing
"renders the eval bar" test inverts into three:
1. drilling → no bar (`queryByRole('img', {name: /Engine evaluation/})` is null)
2. explore active, engine off → toggle present, still no bar
3. toggle pressed → bar present (jsdom has no `Worker`, so it reads
   "unavailable"; presence is the assertion, as in the test being replaced)

No Practice page test is added — the page has only `pool.test.ts` (pure logic),
and its board markup is identical to Learn's.

## Verification

`npm test`, `npm run lint`, and `npm run check` at zero errors, then the app run
with DevTools Network open: no `stockfish-*.wasm` request while drilling Learn or
Practice, one after pressing the toggle in explore, none again after a reload
until the toggle is pressed.
