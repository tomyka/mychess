# Board Customization — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)

## Goal

Let each user customize the chess board's appearance and persist the choice to
their account, so every board across the app (drill, master/train, previews)
renders in their preferred style. Closes the visual gap with sites like
chessreps.com — which use the same underlying library (chessground) but ship
richer themes, piece art, and animation.

No library swap. We stay on **chessground 9.2.1 + chess.js** and add
configuration + assets on top.

## Scope

Four user-configurable options:

1. **Board color theme** — brown / green / blue-grey / midnight slate.
2. **Piece set** — cburnett / merida / alpha (open-source, GPL, as used by Lichess).
3. **Animation** — off / subtle / snappy (move animation duration).
4. **Toggles** — show coordinates; highlight last move.

**Save model:** live preview updates on every control change; changes only
persist and apply app-wide on an explicit **Save** click. A **Reset to default**
control restores defaults (unsaved until Save).

**Persistence:** a single `board_prefs jsonb` column on `profiles`. Because this
app gives guests an anonymous `profiles` row, profile storage covers guests too,
and prefs load server-side so the board renders correctly on first paint (no
flash of default theme).

**Out of scope (future):** additional piece sets/themes, per-repertoire board
overrides, board sound effects, custom highlight colors.

## Data

### Migration

`supabase/migrations/0024_board_prefs.sql`:

- `ALTER TABLE profiles ADD COLUMN board_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;`

Single extensible column — no future migration per new option. Existing rows and
guests get `{}`, and code fills in defaults for any missing key, so old rows and
guests just work. No new RLS needed: the existing `profiles` self-update policy
already covers writing this column (the settings action updates the caller's own
row via `.eq('id', user.id)`). Per project convention, confirm the live
`profiles` shape before relying on the migration having run.

### Stored shape

```json
{
  "theme": "brown",
  "pieceSet": "cburnett",
  "animation": "subtle",
  "coordinates": true,
  "highlight": true
}
```

## Pure logic — `src/lib/board/prefs.ts` (+ `prefs.test.ts`)

Follows the project's "pure logic vs. Supabase I/O" split — no DB imports, fully
unit-tested.

Exports:

- `type BoardPrefs = { theme: BoardTheme; pieceSet: PieceSet; animation: AnimationSpeed; coordinates: boolean; highlight: boolean }`
- `BOARD_THEMES` — catalog: `{ id, label, light, dark }[]` (the two square colors per theme).
- `PIECE_SETS` — catalog: `{ id, label }[]` (`cburnett`, `merida`, `alpha`).
- `ANIMATION_SPEEDS` — `{ id, label, durationMs }[]` → off:0, subtle:200, snappy:120.
- `DEFAULT_PREFS: BoardPrefs` — brown / cburnett / subtle / coords on / highlight on.
- `parseBoardPrefs(raw: unknown): BoardPrefs` — merges arbitrary jsonb over
  defaults, discarding any value not in the corresponding catalog (guards
  against stale/garbage data). Always returns a complete, valid object.

### Tests (`prefs.test.ts`)

- `parseBoardPrefs({})` → `DEFAULT_PREFS`.
- unknown `theme`/`pieceSet`/`animation` values fall back to the default for that key.
- valid partial object merges over defaults (only provided keys change).
- non-object input (`null`, `undefined`, string, number) → `DEFAULT_PREFS`.
- boolean toggles parsed as-is; non-boolean toggle values fall back to default.

## Assets

### Board themes — CSS only, no images

Each theme is two colors applied to the chessground board as a CSS checkerboard
(`background-color` = light square, a `linear-gradient` overlay = dark square),
scoped by a wrapper class `board-theme-<id>`. Zero image bytes. Last-move /
selected highlight uses a single shared accent (existing behavior) rendered over
the squares.

### Piece sets — bundled SVG

Copy the 12 SVGs (6 roles × 2 colors) for each of cburnett, merida, alpha from
the Lichess `lila` asset set (GPL) into `static/pieces/<set>/<color><ROLE>.svg`
(e.g. `wP.svg`, `bN.svg`). A stylesheet `src/lib/board/pieces.css` maps, per set,
`.pieces-<set> piece.<role>.<color> { background-image: url(/pieces/<set>/…) }`.
chessground already renders pieces as `<piece class="pawn white">` elements, so
this is pure CSS layered on its markup.

License: attribute the piece sets' GPL license in a short `static/pieces/LICENSE`
note.

## Component — extend `ChessBoard.svelte`

Add one optional prop:

- `prefs?: BoardPrefs` — defaults to `DEFAULT_PREFS` when omitted, so every
  existing call site keeps working unchanged.

Behavior:

- Apply `board-theme-<prefs.theme>` and `pieces-<prefs.pieceSet>` classes on the
  board wrapper element.
- Pass chessground config from prefs:
  - `animation: { enabled: durationMs > 0, duration: durationMs }`
  - `coordinates: prefs.coordinates`
  - `highlight: { lastMove: prefs.highlight, check: prefs.highlight }`
- When `prefs` changes reactively (settings live preview), rebuild/patch the
  chessground config the same way the component already reacts to `fen`.

The component keeps its current props (`fen`, `orientation`, `interactable`,
`lastMove`, `onmove`) and current default appearance when no prefs are passed.

## Wiring — SSR

`safeGetSession()` already returns `profile`, and `(player)/+layout.server.ts`
returns that session data. Add parsed prefs to the layout's returned data:

- In `(player)/+layout.server.ts`, compute `boardPrefs = parseBoardPrefs((data.profile as any)?.board_prefs)` and include it in the returned object.
- Board-hosting pages read `data.boardPrefs` (via `$page.data` / their `data`
  prop) and pass it to `<ChessBoard prefs={...} />`.

This gives correct first-paint rendering with no client round-trip. Pages
outside `(player)` that render a board (if any) fall back to `DEFAULT_PREFS`.

## Settings UI — existing `(player)/settings` route

Add a "Board" section below the existing profile form (`+page.svelte`), matching
the page's existing card/Tailwind style:

- **Live preview**: a non-interactable `<ChessBoard>` bound to local `$state`
  prefs, showing a fixed sample position (after `1.e4`) with a last move so the
  highlight toggle is visible.
- **Controls**:
  - Board theme — swatch buttons (light/dark split), reusing the established
    two-button-toggle-style pattern (buttons + hidden input), not a `<select>`.
  - Piece set — chip buttons.
  - Animation — off/subtle/snappy chips.
  - Coordinates, Highlight last move — toggle switches.
- **Save / Reset** buttons. Form submits via `use:enhance` to a new
  `save_board_prefs` action; local state seeds from `data.boardPrefs`. Reset sets
  local state to `DEFAULT_PREFS` (persisted only on Save).

### New action — `+page.server.ts`

`save_board_prefs`:

- `requireAccount` / `safeGetSession` guard (matches existing actions).
- Read the five fields from `formData`, build a candidate object, run it through
  `parseBoardPrefs` to validate/normalize (never trust the client).
- `supabase.from('profiles').update({ board_prefs: prefs }).eq('id', user.id)`.
- Return `{ success: true }` / `fail(...)` consistent with the existing `save`
  action. Load returns `boardPrefs` so the section renders current values.

## Testing

- **Unit (vitest):** `prefs.test.ts` as specified above — the core validation
  logic. Per project convention, the DB-writing action and the Svelte component
  are not unit-tested directly; they are thin wrappers exercised through the pure
  logic plus manual / e2e verification.
- **Type gate:** `npm run check` must add no new errors beyond the known ~12
  OAuth baseline.
- **Manual verification:** in the running app, open Settings → Board, change each
  control (confirm live preview updates), Save, reload, confirm persistence, then
  open a drill/master board and confirm the chosen theme/pieces/animation/coords
  apply there too. Confirm a guest session renders defaults without error.

## Files touched

**New**
- `supabase/migrations/0024_board_prefs.sql`
- `src/lib/board/prefs.ts` + `src/lib/board/prefs.test.ts`
- `src/lib/board/pieces.css`
- `static/pieces/{cburnett,merida,alpha}/*.svg` + `static/pieces/LICENSE`

**Modified**
- `src/lib/components/ChessBoard.svelte` — `prefs` prop + config wiring + theme/piece classes
- `src/routes/(player)/+layout.server.ts` — return parsed `boardPrefs`
- `src/routes/(player)/settings/+page.svelte` — Board section + live preview
- `src/routes/(player)/settings/+page.server.ts` — `save_board_prefs` action; load returns `boardPrefs`
- Board-hosting pages (drill, master/train) — pass `prefs={data.boardPrefs}` to `<ChessBoard>`
- import the theme + `pieces.css` into the global stylesheet

## Risks / notes

- **Migration drift**: confirm live `profiles` shape and that the migration ran
  before relying on `board_prefs`.
- **Piece-set bundle size**: 3 sets × 12 small SVGs ≈ negligible; served static,
  cached by the existing PWA `NetworkFirst`/precache config.
- **chessground config reactivity**: ensure changing `prefs` on the live preview
  patches config without re-snapping the position (same care the component
  already takes for `fen` vs. non-position prop changes).
