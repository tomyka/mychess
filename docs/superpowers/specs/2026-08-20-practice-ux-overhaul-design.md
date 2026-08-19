# Practice screen UX overhaul

GitHub issue: [#92](https://github.com/tomyka/mychess/issues/92).

## Problem

`/practice/[repertoire_id]` (`src/routes/(player)/practice/[repertoire_id]/+page.svelte`) works but doesn't teach. Twelve concrete issues were catalogued against the live desktop screen — no on-screen instruction, a ~200px dead gap between board and move-nav, an undersized board, a mostly-empty sidebar, help hidden until three wrong attempts, an unlabeled engine panel, sound-only feedback, hardcoded `gray-*` colors leaking through both themes, inverted text hierarchy, and no way to end a session. Full detail, the annotated mockup, and lichess/chess.com/chessreps competitor research live in issue #92 — this spec resolves the three decisions the issue left open and specifies the implementation.

## Decisions (resolving issue #92's open items)

- **Hint marks the pass not-clean.** The hint becomes available every turn (no more three-strikes gate), but requesting it sets the same `attemptHadMistake` flag a wrong move sets — so a hinted attempt can never bump `solved`. Corroborated by chess.com's own puzzle trainer: "Using a Hint counts as a failed attempt, just like making an incorrect move."
- **Board sizing stays on `containerFit`/cqh, not a raw viewport calc.** `ChessBoard.svelte`'s own comments document a real, previously-shipped bug: an earlier `max-width` calc + `height: 100%` approach produced non-square boards on mychess.lt when width (not height) was the binding constraint. The actual cause of the current gap isn't the sizing mechanism — it's that the board's `flex-1` container centers its child (`items-center justify-center`) instead of anchoring it to the top, so when a narrow page makes board *width* the binding constraint, the board renders shorter than its slot and the slack splits above and below. Fix: widen the page and stop centering, keep `containerFit` exactly as-is.
- **Variation picker stays a modal.** Converting `VariationPicker` into a permanent left rail (as both lichess surfaces do) is a bigger structural change than the rest of this epic and is deferred to a follow-up issue, filed once this ships.
- **chess.com/chessreps research:** done via text-based `WebFetch`/`WebSearch` (no visual capture possible in this environment). Findings corroborate, and don't contradict, the lichess-based decisions above: chess.com's hint sits at the bottom of a right sidebar and cost a puzzle-rating hit exactly like a wrong move; chessreps uses a left-rail list of drill sets with per-set progress counts. Nothing from this pass changes scope.

## Goals

Each maps to an acceptance criterion in issue #92:

1. A standing status strip above the board, fixed min-height (no layout shift), `role="status"`, silent while a teaching arrow is showing, otherwise reflecting: blind retest / wrong / correct / autoplay intro / pre-retest cue (the last three already exist as `teachCue`/phase state — the strip unifies them with the two new states).
2. No vertical gap between board and move-nav at any desktop viewport (see Architecture).
3. Board scales with viewport height; page grows to `max-w-7xl`.
4. Sidebar carries: progress, this-line (moves played + mistakes-this-attempt), engine (now labeled with a legend), help (always-visible hint + keyboard legend), session (solved-this-session + Finish session).
5. Hint offered every turn; arrow-key nav documented on screen.
6. Nav row shows ply position (`3 / 12`) and inline-SVG icons at text contrast instead of unicode glyphs at muted contrast; existing `aria-label`s unchanged (tests assert on them).
7. Engine block gets an "Engine" label and a White/Black legend on the eval bar.
8. Correct/wrong feedback gets a visible strip message in addition to the existing sound + board tint.
9. No hardcoded `gray-*` left in the practice route or `EngineEval.svelte` (its bar is only ever rendered on this route).
10. Repertoire name promoted to the page header row; sidebar drops the duplicate.
11. Session counter (solved this session) + Finish session control.
12. No code change — `DEFAULT_PREFS.coordinates` is already `true`; documented as a settings default, not a bug.

## Non-goals

- Mobile layout rework beyond keeping the existing single-column behavior working (mobile already has most of these cards inline; this pass focuses on desktop's two-column layout).
- Changing the teaching algorithm, mastery model, or what counts as solved, other than the hint decision above.
- Board theme / piece set work.
- Coach-facing practice reports.
- Converting the variation picker to a permanent rail (see Decisions — separate follow-up issue).
- Surfacing chapter name in the "this line" sidebar card — no chapter data currently reaches this route's client (`+page.server.ts` never sends it), and it's not in the acceptance criteria; the card uses moves-played + mistakes-this-attempt instead. Plumbing chapter name through is a small, separate follow-up if wanted later.

## Architecture

### Layout: width, gap, and flush-top sizing

- `<main>`'s `max-w-5xl` → `max-w-7xl` (`+page.svelte:386`).
- Sidebar column (`+page.svelte:527`) becomes a fixed `lg:w-80 shrink-0` instead of `lg:flex-1 lg:min-w-72 lg:max-w-sm` — a fixed rail rather than a second flex-1 competing with the board column for width.
- The board's sizing container (`+page.svelte:467`) keeps `containerFit`/cqh exactly as implemented, but drops vertical centering: `lg:items-center` → `lg:items-start` (keep `lg:justify-center` for horizontal centering). This alone closes the gap for the same reason described in Decisions — remaining slack (on a viewport where width still binds) now collapses to the top instead of splitting around the board.
- Repertoire title moves into the page header row (next to "← All Repertoires"), sized as a real heading; the sidebar's duplicate title (`+page.svelte:531`) is removed. Solves goal (10).

### Status strip

New component, rendered directly above the board wrapper (replacing the current `teachCue` block and the two duplicate hint buttons at `+page.svelte:456` and `:558`):

```
type StripState =
  | { kind: 'blind' }               // no arrow, live retest — "Play it from memory"
  | { kind: 'wrong' }                // "✗ Not that move — try again"
  | { kind: 'correct' }               // "✓ Correct"
  | { kind: 'autoplay' }              // "Replaying what you already know…"
  | { kind: 'retest-cue' }            // existing teachCue — "🧠 Nice — now play it from memory"
  | { kind: 'silent' };               // teaching arrow is up — strip renders nothing
```

Derived in `+page.svelte` from existing state (`phase`, `arrowMove`, `teachCue`) plus two new transient flags set in `handleMove`: `lastMoveResult: 'correct' | 'wrong' | null`, cleared on the next attempt. `'wrong'` holds through the existing wrong-move flow (no timeout needed — it clears itself the moment the player's next attempt on the same square runs `handleMove` again); `'correct'` holds for the same 500ms window the board already holds the correct-move feedback (`advanceTimeout`), then reverts to whatever the next state is.

Priority order (highest first): `silent` (arrow showing) → `retest-cue` → `wrong` → `correct` → `autoplay` → `blind`. Fixed `min-h-[2.5rem]` (or equivalent) regardless of which branch renders, including `silent`, so nothing shifts.

Colors reuse the exact hex values `ChessBoard.svelte`'s own feedback glyphs use for consistency: `#6FCF73` (correct) / `#F28B82` (wrong), applied as text/border-tint, not raw Tailwind `green-`/`red-` utilities — keeps the strip visually consistent with the board tint the player already sees, and keeps token usage explicit rather than reintroducing a new hardcoded-color class only to remove `gray-*` ones elsewhere.

### Hint: always available, marks the pass dirty

- Remove the `wrongCount >= 3` gate on both existing hint buttons; replace with a single "Stuck? 💡 Need a hint?" control in the sidebar's new Help card (mobile keeps its own copy, same condition: `phase === 'playing' && !hintRequested && !isReviewing`).
- `onclick`: `hintRequested = true; attemptHadMistake = true;` — the one-line change that implements "hint marks not-clean." `wrongCount` becomes purely informational (still tracked for potential future use, e.g. analytics) and no longer gates anything.
- Help card also lists the arrow-key legend as static text: `← → step through moves you've played · ↑ jump to start · ↓ jump to live position`.

### Nav row

Same four actions (`reviewToStart/Back/Forward/ToLive`), same `aria-label`s (unchanged — tests assert on them). Changes:
- Center cell becomes a ply indicator, `{reviewIdx} / {quizSteps.length}`, replacing the implicit 4-button grid with a 5-cell row (`⏮ ◀ [n/N] ▶ ⏭`).
- Unicode glyphs (`⏮ ◀ ▶ ⏭`) replaced with small inline `<svg>` icons at `text-(--color-text)` / `border-(--color-border)` contrast instead of `--color-muted`, matching goal (6)'s "readable icons" requirement.
- `hover:bg-gray-50 dark:hover:bg-gray-800` (five occurrences across nav buttons and the Switch/hint buttons) → `hover:bg-(--color-border)/50`-style token-based hover, consistent with the rest of the app's surface/border tokens.

### Sidebar cards (desktop, `lg:w-80` rail)

In order, replacing the current Progress/Engine/Moves-played/Hint blocks:

1. **Progress** — count + bar (bar track becomes `bg-(--color-border)` instead of `bg-gray-200`, fixing goal (9)'s "progress bar invisible at 0%" — the border token renders visibly in both themes, unlike the light-mode-only gray) + the existing Switch button.
2. **This line** — moves played (existing `movesSoFar`) + a new mistakes-this-attempt chip (`attemptMistakeCount`, a new `$state` counter incremented alongside `attemptHadMistake` on a wrong move, reset in `resetForAttempt()`; renders only when > 0).
3. **Engine** — `EngineEval.svelte` gains an "Engine" label (plain text next to the existing toggle) and a White/Black legend under the bar (two small swatches or the letters "W"/"B" at each end). Its bar track (`bg-gray-800`, `EngineEval.svelte:197`) becomes a token — `bg-(--color-border)` in the unfilled portion — completing goal (9) for the one file outside the route itself that currently hardcodes a gray.
4. **Stuck?** — the relocated, always-visible hint control plus the keyboard legend (see Hint section above).
5. **Session** — `{solvedThisSession} solved this session` (new `$state`, incremented client-side whenever a final, clean pass lands — mirrors the existing `optimisticSolvedAfterAttempt` bump condition, reset only on full page load) + a "Finish session" button linking to `/practice`, visually distinct (secondary style) from the existing "← All Repertoires" link so both can coexist without looking redundant.

### Token cleanup

Beyond the two `gray-*` occurrences called out above (progress track, engine bar track): `text-gray-300` separator (`+page.svelte:435`, mobile-only header) → `text-(--color-border)`.

## Error Handling

No new failure modes — every change here is presentational or derives from state that already exists and is already reset correctly in `resetForAttempt()` (new counters `attemptMistakeCount`/`lastMoveResult` are added to that function's existing reset block). `solvedThisSession` is deliberately the one piece of new state *not* reset there, matching how `data.solved` itself persists across attempts within a session.

## Testing

- Existing tests asserting on nav-row `aria-label`s continue to pass unchanged (goal (6) explicitly preserves them) — verify with `npm test` after the icon swap, not just visually.
- New unit coverage in `src/lib/mastery/practice.test.ts` or a colocated helper test for any pure logic extracted (e.g. a `stripStateFor(...)` derivation function, if pulled out of the component for testability rather than left as inline `$derived.by`).
- Manual verification (per this repo's UI-change convention): run the dev server, walk through a repertoire on a real desktop viewport confirming (a) no gap between board and nav at both a wide and a narrow-but-tall window, (b) status strip shows the right copy for a wrong move, a correct move, an autoplay intro, and the retest cue, with no layout shift, (c) hint button appears immediately (no 3-strikes wait) and taking it prevents that pass from counting as solved, (d) dark and light theme both render the progress bar and engine bar tracks visibly, (e) Finish session navigates back to `/practice`.
- `npm test` and `npm run check` both clean before push (issue's own acceptance criterion).

## Rollout

Single-branch, in-place UI change (no schema/migration involved) — implemented directly per this repo's "small iterative UI/UX fixes are made directly in-place" convention, still gated on `vitest` + `svelte-check` before commit. One commit (or a small stack) covering: layout/gap/width fix, status strip, hint-gate removal + dirty-marking, nav row icons/ply indicator, sidebar card restructure, engine legend + token cleanup. File the deferred variation-picker-rail idea as a new follow-up issue once this merges, per the Decisions section.
