# Many-to-Many Coach–Player Relationship

**Date:** 2026-07-06
**Status:** Approved for planning

## Problem

MyChess models the coach–player relationship as exactly one coach per player: a single nullable `profiles.coach_id` column, set only via a coach-generated invite link that a player redeems. There's no way for a player to have multiple coaches, no way for a coach to browse and add players directly, and no player-facing view of "who is my coach" at all.

This is the first of three planned subsystems (coach–player relationship, player-side repertoire creation, coach task system) — each gets its own spec and plan. This spec covers only the relationship.

## Decisions

- **Many-to-many.** A player can have 0–many coaches; a coach can have 0–many players.
- **Two ways to form a relationship:**
  1. **Invite link (existing flow, kept as-is).** Coach generates a link via `/coach/invite`; player redeems it at `/join/[token]`. Redeeming counts as consent from both sides (the coach already consented by creating the link) — the relationship becomes active immediately, no separate approval step.
  2. **Direct request (new).** Either side browses a searchable list of the other role and sends a request. The other side must Accept or Decline before the relationship becomes active.
- **Browsing is unrestricted.** Any player can browse the full list of coaches (filterable by name), and any coach can browse the full list of players (filterable by name) — not scoped to existing connections.
- **Either side can unlink an active relationship at any time.** Repertoire/task assignments already made are unaffected — they reference `player_id`/`coach_id` directly, not the relationship row, so they survive an unlink.
- **Tighten `assigned_repertoires`' RLS policy.** Today any coach can assign any repertoire to any player (a role check only, no relationship check) — a pre-existing gap. This work fixes it to require an active `coach_players` row between the two, since it's the exact relationship this feature formalizes.
- **No notifications (email or otherwise).** Pending requests surface only when the recipient visits their own coach/student-management page — consistent with how the rest of the app already works (e.g. invites are just a list you check).

## Architecture

### New table: `coach_players`

Replaces `profiles.coach_id` as the source of truth for the relationship.

```sql
create table public.coach_players (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles(id),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  status        text not null check (status in ('pending', 'active')),
  requested_by  uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (coach_id, player_id)
);
```

- `requested_by` records who is waiting on the other side's response — the id of whichever of `coach_id`/`player_id` initiated. For rows created by invite-link redemption, `requested_by` is set to `coach_id` (the link creator) and `status` is inserted directly as `'active'`.
- The `unique (coach_id, player_id)` constraint means only one relationship row can exist per pair at a time — no duplicate pending requests, no coexisting pending+active rows for the same pair.

### Lifecycle

- **Player requests a coach:** insert `(coach_id, player_id, status='pending', requested_by=player_id)`. Coach sees it as incoming; Accept sets `status='active', responded_at=now()`; Decline deletes the row.
- **Coach requests a player:** same shape, `requested_by=coach_id`; player accepts/declines.
- **Invite redeemed:** insert directly as `status='active', requested_by=coach_id, responded_at=now()`. The `invites` table and its redemption token logic are unchanged; only what happens *after* a successful redemption changes (write to `coach_players` instead of `update profiles set coach_id`).
- **Unlink:** delete the row. Works the same regardless of how the relationship formed. A pair can re-request after unlinking — the unique constraint only blocks simultaneous rows, not history.
- A user attempting to request a pair that already has a `pending` or `active` row gets a clear error rather than a duplicate-key failure (checked before insert, see Error Handling).

### RLS changes

Every existing policy that currently gates on `profiles.coach_id = auth.uid()` changes to an `exists` check against `coach_players` with `status = 'active'`:

- `profiles_coach_read`
- Coach-read policies on `repertoires`, `moves`, `reviews`, `sessions`, `player_stats`, `badges_earned`
- `assigned_repertoires`' "Coaches manage assignments" policy — tightened from a bare `role = 'coach'` check to requiring an active `coach_players` row for that specific coach/player pair (this is the one deliberate behavior change beyond plumbing, per the earlier decision to close this gap).

New policies needed for browsing:
- Any authenticated player can `select` basic fields (`id`, `first_name`, `last_name`, `display_name`, `avatar_id`) of any profile with `role = 'coach'`.
- Any authenticated coach can `select` the same basic fields of any profile with `role = 'player'`.
- Both directions: a user can always read/manage `coach_players` rows where they are either `coach_id` or `player_id`.

`profiles.coach_id` is dropped once all reads/writes have moved to `coach_players`.

## UI / Routes

- **`(player)/coaches/+page.svelte` + `+page.server.ts`** (new). Three sections:
  - **My Coaches** — active relationships, each with a Remove button.
  - **Pending** — requests the player sent (with Cancel) and requests received from coaches (with Accept/Decline).
  - **Find a Coach** — full coach list with a name/surname filter box, Request button per coach (hidden/disabled if a pending or active row already exists with that coach).
- **`(coach)/coach/students/+page.svelte` + `+page.server.ts`** (new). Mirrors the player page: My Students / Pending / Find a Player.
- **`(coach)/coach/+page.svelte`** (existing dashboard, minor change). Gains a small banner when there are pending incoming requests, linking to `/coach/students`. Its existing active-player list and progress views are otherwise unchanged, now sourced from `coach_players` instead of `profiles.coach_id`.
- **`join/[token]/+page.server.ts`** (existing, modified). Redemption logic changes from `update profiles set coach_id = ...` to inserting an active `coach_players` row.

## Data flow / files touched

- `supabase/migrations/0019_coach_players.sql` (new) — table, RLS policies (new + rewritten), data migration of existing `coach_id` values, column drop.
- `src/routes/(player)/coaches/` (new) — list/request/accept/decline/unlink UI + actions.
- `src/routes/(coach)/coach/students/` (new) — mirrored coach-side UI + actions.
- `src/routes/(coach)/coach/+page.svelte`, `+page.server.ts` (modified) — read from `coach_players`, add pending-requests banner.
- `src/routes/(coach)/coach/players/[player_id]/+page.server.ts` (modified) — read from `coach_players` instead of `coach_id`.
- `src/routes/join/[token]/+page.server.ts` (modified) — write to `coach_players` on redemption.
- `$lib/server/coach-players.ts` (new) — shared helpers: `sendRequest`, `respondToRequest`, `unlink`, `listCoachesFor(player)`, `listPlayersFor(coach)` — centralizes the relationship logic so both new routes and the modified existing routes share one implementation rather than duplicating query/insert logic.

## Error handling

- Requesting a pair that already has a `pending` or `active` row: checked before insert, returns a clear "You already have a pending/active relationship with this coach/player" message rather than surfacing a raw unique-constraint violation.
- Accepting/declining/unlinking a row that doesn't belong to the acting user (or doesn't exist / already resolved by the other side in a race): fails closed via RLS (the update/delete simply matches zero rows), surfaced as "This request is no longer available."
- Browsing lists: if the profile query fails, show an empty list with a generic error banner, matching the existing pattern used elsewhere in this app (e.g. `data.error` handling on `/tournaments`).

## Testing

- Unit tests for `$lib/server/coach-players.ts`'s helpers (request/accept/decline/unlink, including the duplicate-relationship rejection path), following the existing pattern of mocking the Supabase client (as used elsewhere in `src/lib/server/*.test.ts`).
- No RLS-policy-level automated tests exist elsewhere in this codebase today (verified: none of the existing `*.test.ts` files exercise Postgres RLS directly) — this work follows that same precedent and relies on manual verification instead.
- Manual verification: player requests a coach → coach accepts → relationship shows active on both sides → coach assigns a repertoire → player unlinks → repertoire access persists → coach requests a different player → player declines → no relationship created. Also verify the invite-link path still works end to end and results in an active row.

## Non-goals

- No notifications (email/push/in-app toasts) for incoming requests.
- No pagination or advanced filtering of the coach/player browse lists beyond name search — revisit if the platform grows large enough for this to matter.
- No changes to the invite-link token mechanism itself (`invites` table, expiry, token generation) — only what happens after successful redemption.
- Repertoire creation/upload for players and the coach task system are separate, later specs — not covered here.
