# Player Repertoire Creation/Upload

**Date:** 2026-07-06
**Status:** Approved for planning

## Problem

Players can already train repertoires (`/learn`, FSRS-based spaced repetition) and see a list of their own and coach-assigned ones (`/repertoires`), but there's no way for a player to actually create one — the only "create from PGN" tool in the app, `/coach/pgn`, is coach-only and, on inspection, **completely broken**: every database insert it performs (both the `repertoires` row and every `moves` row) references columns that don't exist in the live schema, or omits required ones. Verified directly against the production database — this tool has never successfully created a repertoire.

This is the second of three planned subsystems for coach/player relationships and training (relationship management, done; repertoire creation, this spec; coach task system, later). A related but separate ask — a dedicated "today's reviews" view, training reminders/notifications, and a repertoire-specific streak — was raised during brainstorming and deliberately split off into its own future spec, since reminders alone require standing up email-sending infrastructure this app doesn't have at all today.

## Decisions

- **Fix the broken coach tool as part of this work**, rather than separately. Both the coach and player upload forms need the exact same corrected PGN-import logic; building it once and using it in both places is the natural shape, not scope creep.
- **Both paste-text and file upload are supported**, sharing one text field. A `.pgn` file is just plain text, so a file picker just reads it client-side (browser File API) into the same textarea already used for pasting — no Supabase Storage or other new infrastructure needed.
- **Color (White/Black) is an explicit form field**, not auto-detected. `repertoires.color` is required and isn't reliably inferable from a PGN's move data alone (a repertoire is about which side you're studying, not just whose moves appear in a sample game).
- **Redirect to `/repertoires` (the list) after creation**, not a detail page — `/repertoires/[id]` doesn't exist yet (a pre-existing dangling link on the current list page), and building a repertoire detail/editor view is out of scope here.

## Architecture

### New shared helper: `$lib/server/pgn-import.ts`

```ts
export async function importPgn(
  supabase: SupabaseClient,
  params: { playerId: string; name: string; color: 'white' | 'black'; pgnText: string }
): Promise<{ repertoireId: string; error: null } | { repertoireId: null; error: string }>
```

Using the schema as actually verified in production (not the drifted shape the old broken tool assumed):

1. Parse `pgnText` via the existing, correct `parsePgn()` (`$lib/pgn/parser.ts`, untouched).
2. If zero valid games parsed, return `{ error: 'No valid games found in PGN' }` without touching the database.
3. Insert one `repertoires` row: `player_id`, `name`, `color`. (`is_draft` and `created_at` both have DB defaults nothing in the app currently reads — no need to set them.)
4. For every parsed move, across all games: upsert its `from`/`to` positions by FEN (same dedup-by-unique-FEN pattern the old tool already had right), then insert into `moves` with the **real** column names — `repertoire_id`, `from_position`, `to_position`, `san`, `move_number` (the parser's `ply`), `is_player_turn` (`move.color === color` — true for the studied side's own moves, false for the opponent's replies; this column is currently unread by the training engine but is `NOT NULL`, so needs a sensible value regardless), `annotation` (from the parser, if present).
5. Return the new repertoire's id.

Multiple games in one pasted/uploaded PGN blob merge into the same repertoire's move tree (already how positions/moves are keyed — by FEN and by `(repertoire_id, from_position, san)` respectively), matching the existing intended design.

### Fix: `/coach/pgn`

- `+page.server.ts`'s `upload` action: replace the inline (broken) insert logic with a single call to `importPgn`.
- `+page.svelte`: add a White/Black `<select>` (currently missing entirely, which is part of why the required `color` field was never being set).

### New: `(player)/repertoires/new/`

- `+page.svelte`: Name field, White/Black two-button toggle (visually matching the existing pattern from Settings' Player/Coach switch), a PGN textarea, and a file `<input type="file" accept=".pgn">` whose `onchange` reads the selected file's text via `FileReader` and writes it into the same textarea (so only one field is ever actually submitted).
- `+page.server.ts`: single `create` action calling `importPgn`. On success, `redirect(303, '/repertoires')`. On failure, `fail(400, { error })` — matching this app's established form-error display pattern.
- `(player)/repertoires/+page.svelte`: add a "Create Repertoire" button/link to `/repertoires/new`, replacing the current dead-end "create your own" text hint.

## Data flow / files touched

- `mychess/src/lib/server/pgn-import.ts` (new) — `importPgn`.
- `mychess/src/routes/(coach)/coach/pgn/+page.server.ts` (modified) — use `importPgn`, remove the broken inline logic.
- `mychess/src/routes/(coach)/coach/pgn/+page.svelte` (modified) — add color selector.
- `mychess/src/routes/(player)/repertoires/new/+page.server.ts` (new).
- `mychess/src/routes/(player)/repertoires/new/+page.svelte` (new).
- `mychess/src/routes/(player)/repertoires/+page.svelte` (modified) — add the "Create Repertoire" link.

## Error handling

- Empty name or empty PGN text: `fail(400, { error: 'Name and PGN are required' })`, checked before calling `importPgn` (matching the old tool's existing shape of this specific check).
- No valid games parsed: `importPgn` itself returns this error; both callers surface it via `fail(400, { error })`.
- Any database error during the insert sequence: surfaced as `fail(500, { error: error.message })`, consistent with how the rest of this app's server actions handle DB errors.
- A `.pgn` file that fails to read (rare — corrupt file, browser API failure): caught client-side, shown as an inline message near the file input; doesn't block using the textarea directly instead.

## Testing

- `parsePgn` already has its own test coverage — untouched by this work.
- `importPgn` is a Supabase-touching helper — following this codebase's established convention (used consistently throughout the coach-player relationship work), no dedicated unit test; correctness is verified via the component tests below plus manual end-to-end verification on production.
- Component test for `(player)/repertoires/new/+page.svelte` (mocked `form` prop, following the pattern used for the coach-player pages): renders the form fields, shows a form error when present.
- Manual verification on production: as a player, create a repertoire by pasting a short PGN, confirm it appears in "My Repertoires" and is trainable via `/learn`; repeat via file upload; as a coach, use the (now-fixed) `/coach/pgn` tool to create a repertoire for a connected student, confirm it appears as "Assigned by your coach" on that student's `/repertoires` page.

## Non-goals

- No repertoire detail/editor page (`/repertoires/[id]`) — the existing dangling link on the list page is a separate, pre-existing gap, not addressed here.
- No changes to the FSRS training engine, review scheduling, or the `/learn` page itself.
- The "today's reviews" view, training reminders/notifications, and a repertoire-specific streak are explicitly out of scope — a separate future spec.
- No Supabase Storage setup — not needed, since `.pgn` files are read as plain text client-side.
