# Explore mode for Game Analysis + Drive-icon grayscale — design

## What this is

Two small, related UI additions:

1. **Free-form move exploration on the Game Analysis board** (`/games/[game_id]`) — previously an explicit v1 non-goal in the Game Analysis design. A new magnifying-glass button in the move bar (`MoveNavRow`) lets the player play alternative moves from the currently-reviewed position, with a live evaluation bar, then return to normal step-through review exactly where they left off.
2. **Desaturate the Google Drive logo** (the only purely decorative multicolor icon in the app) to grayscale, via a stock Tailwind utility class.

## Non-goals

- No changes to Learn's or Practice's own explore trigger (the below-row `🔍 Explore this position` text link) — they keep their existing UX untouched.
- No grayscaling of the correct/wrong move-feedback glyphs (`ChessBoard.svelte`) or the coach player-detail accuracy chart — both use color as a meaningful signal, not decoration, and were explicitly excluded during design.
- No persistence of anything explored — matches `ExploreSession`'s existing contract (an excursion never touches recorded state).

## Part 1: Explore mode

### Reused, unmodified

- `ExploreSession` (`src/lib/mastery/explore.svelte.ts`) — off-book scratch-board class already used by Learn/Practice. `start(fen)`, `play(from,to)`, `undo()`, `stop()`, `active`/`fen`/`depth` state.
- `EvalBar` (`src/lib/components/EvalBar.svelte`) + the shared engine singleton (`src/lib/engine/engine.svelte.ts`) — live evaluation for a position with no precomputed eval, which an explored position always is. No `bookEval` passed.

### `MoveNavRow.svelte` — one new optional prop

```typescript
onExplore?: () => void;
```

When provided, the grid becomes 6 columns instead of 5, adding a magnifying-glass-with-plus icon as the 6th cell (outlined stroke style, matching a reference the user provided — visually distinct from the row's other 5 filled-path icons, by explicit approval during design). When omitted (Learn's and Practice's existing call sites, unchanged), the row renders exactly as it does today — 5 columns, no behavior change, no risk to those pages.

```svelte
{#if onExplore}
	<button onclick={onExplore} aria-label="Explore this position" class={buttonClass}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mx-auto" aria-hidden="true">
			<circle cx="10.5" cy="10.5" r="6.5" />
			<line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
			<line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
			<line x1="15.3" y1="15.3" x2="20" y2="20" />
		</svg>
	</button>
{/if}
```

The grid's column count switches between 5 and 6 based on whether `onExplore` was passed (Tailwind's `grid-cols-5`/`grid-cols-6`, chosen via a ternary), rather than always reserving a 6th slot.

### Games page (`src/routes/(player)/games/[game_id]/+page.svelte`)

- `const explore = new ExploreSession();`
- The position-at-reviewIdx logic (currently named `displayFen`) is renamed `reviewFen`; `displayFen` becomes `explore.active ? explore.fen : reviewFen` — the value actually fed to `ChessBoard`, matching Practice's exact pattern.
- `startExplore()` calls `explore.start(reviewFen)`; `stopExplore()` calls `explore.stop()`.
- The `<MoveNavRow>` block is only rendered when `!explore.active`; while exploring, it's replaced by a 2-column "↶ Undo / ↩ Back to review" row (same markup/classes Practice already uses, `disabled={explore.depth === 0}` on Undo).
- `onExplore={analyzing ? undefined : startExplore}` — the button (and its column) simply isn't rendered while a batch analysis is in flight, avoiding two Stockfish workers competing for CPU. This is a minor, accepted layout-shift tradeoff (the button appears fresh once analysis finishes) rather than adding a separate `disabled` prop to `MoveNavRow` for a rare, short-lived state.
- `ChessBoard`'s `interactable`, `onmove` (wired to `explore.play(from, to)`), `lastMove`, and `arrowMove` all become conditional on `explore.active` — `lastMove`/`arrowMove` are suppressed (`undefined`/`null`) while exploring, since they describe the *recorded* game's move, not the excursion. A new `boardWidth` state var is bound from `ChessBoard` (previously unused on this page) so `EvalBar`'s `height` prop can match it.
- The stored-analysis line ("Eval: ... · Blunder · Best was ...") is hidden while exploring (`{#if currentEntry && !explore.active}`) — it describes the recorded move at `reviewIdx`, not the explored position.
- `EvalBar` renders only while `explore.active`, beside the board, exactly like Practice's layout.

## Part 2: Drive icon grayscale

Add `grayscale` (Tailwind's stock utility, `filter: grayscale(100%)`) to the existing `class` attribute of the Google Drive `<svg>` in:
- `src/lib/components/PgnImportForm.svelte`
- `src/routes/(player)/games/new/+page.svelte`

No per-path recoloring — the multicolor paths stay as-is in the source; the filter desaturates them at render time.

## Testing

- `MoveNavRow.test.ts` (new file — none exists today): renders 5 columns and no explore button when `onExplore` is omitted; renders 6 columns with a working explore button when provided.
- `src/routes/(player)/games/[game_id]/analysis.test.ts` (existing file, new tests): clicking the explore button enters explore mode (board becomes interactive, Undo/Back-to-review row replaces `MoveNavRow`); playing a move updates the board; "Back to review" returns to the previously-reviewed position unchanged; the explore button doesn't render while `analyzing` is true.
- `PgnImportForm.test.ts` / `games/new/new.test.ts` (existing files): the Drive icon's `<svg>` carries the `grayscale` class.

## Sizing

Task-sized (not an epic) — almost entirely reuse of two already-built, already-tested modules (`ExploreSession`, `EvalBar`) plus one additive, backward-compatible prop on a shared component and a two-line CSS change. Implemented directly with TDD, no isolated worktree.
