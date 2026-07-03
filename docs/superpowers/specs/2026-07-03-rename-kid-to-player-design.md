# Rename "Kid" → "Player" (code + DB schema) — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Scope:** Full rename of every "kid" reference to "player" — code identifiers, route paths, UI text, the `role` value, and the physical database schema (tables, columns, policies, functions).

## Problem / Goal

The platform models trainees as "kid" throughout (route group `(kid)`, `kid_id` columns, `kid_stats` table, `role = 'kid'`, RPC `sync_kid_stats`, UI text). The product term is **Player**. Rename everything so code and schema match the domain language. This precedes the broader platform rework (public-first landing, auth, roles), so later work is written against the new names.

## Non-goals

- No behavioural changes — pure rename. Same queries, same auth, same UI flows.
- Not renaming the `(coach)` role or coach routes.
- Not renaming auto-generated FK/index constraint names (e.g. `reviews_kid_id_fkey`) — internal, invisible, high churn, zero value. They keep working after a column rename.

## Strategy

Rename **in place** (not expand/contract). Postgres propagates a `RENAME COLUMN`/`RENAME TO` into dependent FKs, indexes, views, and RLS policy *expressions* automatically. It does **not** update function bodies (stored as text) or policy/function *names*, so those are handled explicitly. Migration and code deploy together; a brief breakage window while the migration runs and the new code rolls out is accepted.

## Database migration — `0017_rename_kid_to_player.sql`

Executed in this order:

### 1. Rename table
- `kid_stats` → `player_stats`

### 2. Rename column `kid_id` → `player_id`
On every table that has it:
`repertoires`, `reviews`, `sessions`, `player_stats` (formerly `kid_stats`, PK), `badges_earned` (PK part), `coach_notes`, `equipped_cosmetics` (PK), `quests`, `weekly_leaderboard` (PK), `assigned_repertoires`.

Column renames auto-cascade to: FK targets, indexes, the RLS policy USING/WITH CHECK expressions on these tables, and any view referencing them.

### 3. Recreate RPC functions
Function bodies reference the old identifiers as text, so each is re-created with `player_id` / `player_stats`, and parameters renamed `p_kid_id` → `p_player_id`, locals `v_kid_id` → `v_player_id`:
- `update_xp_and_level(p_player_id uuid, p_xp_delta integer)` — keep name
- `update_streak(p_player_id uuid)` — keep name
- `submit_session_result(...)` — keep name; body uses `sessions.player_id`, `player_stats`, etc.
- `increment_new_cards(p_player_id uuid, p_count integer)` — keep name
- `update_weekly_leaderboard(p_player_id uuid, p_xp integer)` — keep name
- `sync_kid_stats(p_kid_id uuid)` → **renamed** `sync_player_stats(p_player_id uuid)`: `drop function if exists public.sync_kid_stats(uuid);` then create the new one.

Each recreated function preserves its original logic, `security definer`/`volatile` attributes, and grants — verified line-by-line against the originals in `0003_rpcs.sql` and `0005_phase_b.sql`.

**Named-argument note:** Supabase `.rpc(name, { p_kid_id })` passes args by name, so renaming a parameter is a breaking change to callers — every `.rpc` call site updates its arg key in the same release (see code section).

### 4. Rename RLS policy names (cosmetic; expressions already auto-updated)
`alter policy … rename to …` for each policy whose name contains "kid":
- `repertoires_kid_all` → `repertoires_player_all`
- `moves_kid_all` → `moves_player_all`
- `reviews_kid_all` → `reviews_player_all`
- `sessions_kid_all` → `sessions_player_all`
- `review_events_kid_all` → `review_events_player_all`
- `kid_stats_self` → `player_stats_self`, `kid_stats_self_insert` → `player_stats_self_insert`, `kid_stats_coach` → `player_stats_coach` (on the renamed `player_stats` table)
- `badges_kid_read` → `badges_player_read`
- `coach_notes_kid_read` → `coach_notes_player_read`
- `cosmetics_kid_all` → `cosmetics_player_all`, `cosmetics_kid_insert` → `cosmetics_player_insert`
- `"Kids manage own quests"` → `"Players manage own quests"`
- `"Kids see own assignments"` → `"Players see own assignments"`

### 5. Role value `kid` → `player`
Order matters (data must be valid before the new constraint):
```sql
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'player' where role = 'kid';
alter table public.profiles add constraint profiles_role_check check (role in ('player','coach'));
```
(If the constraint name differs in the live DB, discover it from `information_schema` and use that — the plan includes the lookup.)

## Code changes

Mechanical, repo-wide (30 files, ~144 occurrences). Transformation rules:

- **Route group:** `src/routes/(kid)/` → `src/routes/(player)/` (route groups don't affect URLs; `$types` regenerate).
- **Coach sub-routes:** `src/routes/(coach)/coach/kids/` → `.../coach/players/` and `[kid_id]/` → `[player_id]/`; update `params.kid_id` → `params.player_id` and any `/coach/kids/...` link hrefs → `/coach/players/...`.
- **Tables:** `.from('kid_stats')` → `.from('player_stats')`.
- **Columns:** `.eq('kid_id', …)`, `kid_id:` object keys, `.select('kid_id, …')`, `.select('… kid_id …')` → `player_id`.
- **RPC calls:** `.rpc('sync_kid_stats', …)` → `.rpc('sync_player_stats', …)`; all `.rpc(…, { p_kid_id: … })` arg keys → `p_player_id`.
- **Role literals:** `role !== 'kid'` / `role === 'kid'` / `role: 'kid'` → `'player'` (e.g. `(player)/+layout.server.ts` guard, `hooks.server.ts` guest-profile insert, `welcome` role option `id: 'kid'` → `'player'`).
- **Identifiers:** `kidId`, `kidIds`, `kid_name`, `kidName`, `p_kid_id` (client-side var names), etc. → player equivalents.
- **Component/prop names & comments:** any `kid`-named prop, local, or comment → player.
- **UI text:** any visible "kid"/"Kids" copy → "Player"/"Players".

The `(coach)` group, `role = 'coach'`, and `coach_id` are untouched.

## Deploy ordering

1. Merge the code change to `main`.
2. Apply `0017` to the database.
3. The Vercel auto-deploy ships the new code.

Between (2) and (3) the live (old) code briefly queries now-renamed columns and errors; between a code deploy and the migration the new code queries not-yet-renamed columns. Keep the gap small; the accepted brief breakage covers it. (Applying the migration immediately before/with the deploy minimises it.)

## Testing

- `npm test` (vitest) fully green — most tests are pure logic; the rename shouldn't change any assertions except identifier-named test fixtures/vars.
- `npm run check` — no new type errors beyond the known pre-existing set.
- Manual smoke after deploy+migration: player dashboard loads (stats/quests/leaderboard), a drill/review submits (exercises `submit_session_result`, `sync_player_stats`, `update_weekly_leaderboard`), coach view of a player (`/coach/players/[player_id]`) loads.

## Risks

- **RPC named-arg keys** — the single easiest thing to miss; a stale `{ p_kid_id }` key silently passes `undefined`. The plan greps every `.rpc(` call and updates arg keys.
- **Function bodies** — must recreate all six with new identifiers; a missed `kid_id` inside a body fails only at call time (not covered by unit tests) → manual smoke covers it.
- **Constraint name** for `profiles.role` may not be the default `profiles_role_check` — discover it at migration time.
- **`weekly_leaderboard` / `player_stats` PK rename** — both use `kid_id` as primary key; renaming the PK column is fine, `on conflict (player_id)` in the recreated RPCs must match.
