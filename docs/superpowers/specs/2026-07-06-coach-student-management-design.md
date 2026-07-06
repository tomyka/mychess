# Coach Repertoire Library, Assignment, and Student Notes

**Date:** 2026-07-06
**Status:** Approved for planning

## Problem

Three related gaps surfaced while investigating a coach's question about how "Upload Repertoire" assigns a PGN to a player:

1. **Repertoire assignment bypasses the proper mechanism.** Uploading a repertoire with a specific student selected in the "Assign to player" dropdown creates the repertoire directly under that student's `player_id` — indistinguishable from something the student made themselves, and invisible to the "Assigned by your coach" section elsewhere in the app (which reads from a separate `assigned_repertoires` table). There's already a working, unused mechanism for proper assignment: `assigned_repertoires` plus an `assignRep` server action, both already implemented — just never exposed through any UI.
2. **The "leave a note for a student" feature has never worked.** Verified directly against the live database: `coach_notes`' real column is `note`, but the write path (`addNote` action), the read path (the player dashboard's unread-note fetch), and the display component (`CoachNoteBanner.svelte`) all reference a `message` column that doesn't exist.
3. **The student-detail page has no UI.** `/coach/players/[player_id]/+page.server.ts` already has a fully working `load` (fetching stats, notes, the coach's own repertoires) and actions (`addNote`, `assignRep`, plus an unrelated `setGoal`) — but `+page.svelte` is a completely empty file. Nothing renders.

## Decisions

- **Repertoire ownership and assignment are now cleanly separated.** Uploading a PGN always creates a repertoire owned by the coach (`player_id` = the coach's own id) — the "Assign to player" dropdown is removed from Upload PGN entirely. Sharing with a specific student happens exclusively via the student-detail page's assign control, which uses the already-existing `assignRep` action.
- **Fix `coach_notes` end-to-end** (three files) so the note-leaving feature actually functions, since the new student-detail page needs to display notes correctly regardless.
- **Build the missing student-detail page UI**: student name, a few key stats, notes (list + add form), what's already been assigned to them, and a control to assign one more of the coach's own repertoires.
- **The `setGoal` action is left alone, un-wired.** It has a separate, unrelated bug (no RLS policy lets a coach write to a student's `profiles` row, so it silently no-ops) — out of scope for this work; no UI is built for it, and the action itself isn't touched.

## Architecture

### Fix: `coach_notes` column mismatch

- `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`'s `addNote` action: read the form field as `note` (renamed from `message` for clarity — this is a form-field name, independent of the DB column, and this template is being built fresh) and insert it as `{ ..., note }`, not `{ ..., message }`.
- `mychess/src/routes/(player)/+page.server.ts`: change `.select('id, message, created_at')` to `.select('id, note, created_at')` on the `coach_notes` query.
- `mychess/src/lib/components/CoachNoteBanner.svelte`: change the prop type and template reference from `note.message` to `note.note`.

### Fix: Upload PGN no longer assigns directly

- `mychess/src/routes/(coach)/coach/pgn/+page.server.ts`: remove the `load` function entirely (its only purpose — feeding the assign dropdown — no longer exists) and the now-unused `listRelationshipsForCoach` import. The `upload` action drops `playerId`/`targetPlayer` and always calls `importPgn({ playerId: user.id, ... })`.
- `mychess/src/routes/(coach)/coach/pgn/+page.svelte`: remove the "Assign to player" `<select>` block, the `data` prop (no longer needed), and its type annotation.

### New: student-detail page UI

`mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts`'s `load` is reshaped (no existing consumer to preserve compatibility with, since the template never existed) to fetch: the student's profile/name, `player_stats` (`select('*')`, matching the existing established pattern of not hand-listing columns for that particular table), the coach's own repertoire library (for the assign dropdown), what's already been assigned to this specific student (a new query against `assigned_repertoires`, joined to `repertoires` for name/color), and the 5 most recent notes.

`+page.svelte` (new template): student name header, a small stats row (level, total reviews, moves learned — using the already-computed `levelFromXp` result), an "Assign a Repertoire" section (dropdown of the coach's own repertoires + Assign button, using the existing `assignRep` action; falls back to a link to Upload PGN if the coach has no repertoires yet) with an "already assigned" list underneath, and a "Notes" section (add-note form + list of existing notes, newest first).

## Data flow / files touched

- `mychess/src/routes/(coach)/coach/players/[player_id]/+page.server.ts` (modified) — `load` reshaped; `addNote` fixed; `assignRep` and `setGoal` untouched.
- `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte` (new content — file exists but is empty today).
- `mychess/src/routes/(coach)/coach/pgn/+page.server.ts` (modified) — `load` removed, `upload` simplified.
- `mychess/src/routes/(coach)/coach/pgn/+page.svelte` (modified) — assign dropdown removed.
- `mychess/src/routes/(player)/+page.server.ts` (modified) — one `.select()` column name fixed.
- `mychess/src/lib/components/CoachNoteBanner.svelte` (modified) — prop/template field fixed.

## Error handling

- `assignRep`, `addNote`: unchanged existing `fail(400/500, { error })` patterns.
- Assigning a repertoire the coach doesn't actually have an active relationship for is already blocked by the RLS policy added in an earlier piece of work (`coach_players_manage_assignments`) — no new check needed here.
- If the coach has no repertoires yet, the assign section shows a message pointing at Upload PGN instead of an empty, unusable dropdown.

## Testing

- No dedicated test for the `+page.server.ts` changes — matches this codebase's established precedent for server-action files with no existing test coverage (verified: neither this file nor `/coach/pgn`'s ever had one).
- A component test for the new `+page.svelte` (mocked `data`/`form` props, following the pattern used for every other new page this session): renders stats/notes/assign sections, shows the empty-state messages when there's nothing to show, shows a form error when present.
- Manual verification on production: as a coach, upload a repertoire (confirm it lands in your own library, not directly on a student), visit a connected student's detail page, assign that repertoire to them, confirm it shows under "already assigned," leave a note, confirm the student sees the note banner on their dashboard.

## Non-goals

- No fix for `setGoal`'s RLS gap — separate, unrelated issue.
- No change to `assigned_repertoires`' schema or RLS (already correctly scoped from earlier work).
- No bulk-assign (assigning one repertoire to multiple students at once) — one at a time, matching the existing `assignRep` action's shape.
