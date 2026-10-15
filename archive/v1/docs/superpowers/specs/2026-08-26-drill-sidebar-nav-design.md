# Move nav bar and move list move into the sidebar

Date: 2026-08-26

## Problem

Learn and Practice currently render `MoveNavRow` (and, while exploring,
`ExploreControls`) directly under the board, width-capped to the board via
`boardWidth`. This session already fixed two board-resize bugs caused by
that row's own contents changing shape (#159, #161) — the underlying
constraint is that *anything* mounted below the board competes with it for
vertical space, so any layout change there risks reintroducing the same
class of bug.

The user wants the board itself to be bigger, matching chess.com's
analysis-board layout: the board fills the available height, and the move
navigation controls live at the bottom of the right-hand sidebar instead.
Chess.com's sidebar also shows a real move list above those controls; ours
today only has a plain wrapped string ("This line" panel) far short of that.

## Decisions

1. **`MoveNavRow`/`ExploreControls` move into the sidebar, desktop only.**
   Both relocate to a `mt-auto` footer at the bottom of the existing `aside`
   sidebar (the same pinning pattern Practice's "Finish session" link already
   uses), replacing their current spot under the board. The sidebar already
   disappears below the `lg` breakpoint, so mobile is untouched: board,
   `MoveNavRow`/`ExploreControls` directly under it with `boardWidth` capping,
   compact mobile-only moves card — pixel-identical to today, including this
   session's resize fixes.
2. **The sidebar's existing "This line" panel gets a real move list**, in
   place of its current plain wrapped string. Chess.com-style — move number,
   White's move, Black's move, one row per full move — but not clickable:
   reviewing a position is already what the nav bar's prev/next buttons do,
   and click-to-jump is a distinct feature with its own interaction questions
   (hover state, current-move highlight, keyboard conflicts) nobody asked
   for. If that turns out to be wanted later, it is a follow-up, not part of
   this change.
3. **No new heading, no redundant panel.** "This line" keeps its existing
   heading and position in the sidebar; only its content changes. Practice
   keeps its chapter-name line above the list, unaffected.
4. **The board needs no sizing changes.** `ChessBoard`'s `containerFit`
   already sizes from its container's available height; removing the nav row
   from that container just gives it more room, automatically.

## Behaviour

**Desktop (`lg:` and up).** The board column contains only the status strip
and the board. The sidebar, stretched to the board column's full height
(`lg:items-stretch` on their shared row, already in place), lists Progress /
This line (now a real move grid) / Stuck? / Session, then the nav
row/explore controls pinned to the very bottom edge — matching chess.com's
stacking of an actions area above a nav-arrows row that sits flush at the
bottom.

**Mobile.** Unchanged: board, nav row (or explore controls) directly under
it with `boardWidth` capping, the existing compact "moves so far" card below
that. None of this is touched by this change.

**Move list.** A line like `1.e4 e5 2.Nf3 Nc6` becomes a small grid:

```
1   e4    e5
2   Nf3   Nc6
```

An odd-length line (mid-attempt, White to move) renders its last row with an
empty Black cell. No moves yet renders the existing `—` fallback.

## Code changes

`src/lib/mastery/variations.ts`
- add `moveSequenceRows(path: VariationStep[]): { number: number; white: string; black: string | null }[]`,
  pairing plies into full-move rows. `moveSequenceLabel` (the joined-string
  form) is unchanged and keeps its existing caller (the mobile compact card).

`src/lib/components/MoveList.svelte` (new)
- takes `rows` (the array above) and renders the grid, or `—` when empty.
  Extracted rather than inlined twice for the same reason `MoveNavRow` and
  `ExploreControls` already are: Learn and Practice need the identical
  thing, and one copy means a formatting fix can't land on one page and miss
  the other.

`src/routes/(player)/learn/[repertoire_id]/+page.svelte` and
`src/routes/(player)/practice/[repertoire_id]/+page.svelte` (near-identical
edits, matching how the two pages already share this markup)
- add a `moveRows = $derived(...)` next to the existing `movesSoFar`, calling
  `moveSequenceRows` over the same slice of steps
- wrap the existing under-board `MoveNavRow`/`ExploreControls` block in a
  `lg:hidden` container (mobile only, unchanged props including `boardWidth`)
- add a second `MoveNavRow`/`ExploreControls` instance inside the sidebar,
  in a `hidden lg:flex mt-auto` footer, same handlers, no `boardWidth`
  (the sidebar is already a fixed width, so nothing needs capping)
- the sidebar's "This line" panel's `<p>{movesSoFar || '—'}</p>` becomes
  `<MoveList rows={moveRows} />`
- Practice's existing `mt-auto` "Finish session" panel loses its `mt-auto`
  (it's no longer the last element) and becomes a normal panel, immediately
  followed by the new nav-row footer

## Tests

`src/lib/mastery/variations.test.ts` — new cases for `moveSequenceRows`:
empty path, an even number of plies, an odd number of plies (trailing row
has `black: null`), and a path starting mid-game on Black to move (mirrors
`moveSequenceLabel`'s existing `...`-prefix case, but as structured data
rather than a string).

`src/lib/components/MoveList.test.ts` (new) — renders the `—` fallback for
an empty array, renders paired rows, renders a trailing white-only row with
its Black cell empty.

`learn.test.ts` / `pool.test.ts` — no existing assertions touch the sidebar
move text directly (checked: neither file greps for `movesSoFar`,
`font-mono`, or a rendered move string), so no updates expected there beyond
whatever the implementation turns up.

## Verification

`npm test`, `npm run lint`, and `npm run check` at zero errors. Manual
check on mychess.lt (this machine's dev server can't boot — Node 20 vs.
Supabase realtime's WebSocket requirement, same limitation noted in #159):
board fills more of the column on desktop, moves render as a grid, nav row
sits at the sidebar's bottom edge, and mobile is unchanged.
