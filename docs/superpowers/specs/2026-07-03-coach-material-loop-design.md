# Coach → Player Material Loop — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Sub-project:** #3 of the platform evolution (#0 rename, #1 public-first, #2 auth done).

## Problem

A coach can assign a repertoire to a player (`assignRep` → `assigned_repertoires`), but the assigned repertoire is owned by the **coach** (`repertoires.player_id = coach`). The player's repertoires page and the `learn` SRS queue only load `repertoires.player_id = self`, and RLS doesn't grant a player read access to a coach's repertoire/moves. So an assigned repertoire is invisible and untrainable to the player — the "get material from your coach" loop is broken on the player side.

## Goal

Close the loop: a player can **see** repertoires their coach assigned and **train** them through the normal drill/review flow; the coach sees the resulting progress (already wired via their player view).

## Non-goals

- No change to the coach experience (assigning, notes, invite/join, dashboard already work).
- No new training mechanics — assigned moves ride the existing SRS queue and review endpoint.
- No copy of the repertoire to the player; the player reads the coach's repertoire in place.
- Role model, gating, welcome flow — unchanged (done in #0–#2).

## Architecture

Training is a unified SRS queue: `learn/+page.server.ts` collects moves from the player's repertoires; reviews are created lazily (`reviews` upsert keyed `player_id,move_id`) when a move is rated via `POST /api/review`. Three changes close the loop.

### 1. RLS — `supabase/migrations/0017_assigned_repertoire_access.sql`
Add two SELECT policies (additive; existing owner/coach policies untouched):

```sql
-- A player may read a repertoire assigned to them by a coach.
create policy "repertoires_player_assigned_read" on public.repertoires
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = repertoires.id and a.player_id = auth.uid()
    )
  );

-- A player may read the moves of a repertoire assigned to them.
create policy "moves_player_assigned_read" on public.moves
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = moves.repertoire_id and a.player_id = auth.uid()
    )
  );
```

`positions` is already `authenticated`-readable. `reviews`/`sessions`/`review_events` already scope to `player_id = auth.uid()`, so a player rating a coach's move writes their own review row — no policy change. `assigned_repertoires` already has "players see own assignments".

Migration is applied by the user (Supabase SQL editor / db push); no data change.

### 2. Player repertoires page — see assigned material
`(player)/repertoires/+page.server.ts` load additionally fetches assigned repertoires:
```ts
const { data: assigned } = await supabase
  .from('assigned_repertoires')
  .select('repertoire:repertoire_id ( id, name, color, moves(count) )')
  .eq('player_id', user!.id);
```
Returns `assignedRepertoires` = the mapped `repertoire` objects (filter out any null). `(player)/repertoires/+page.svelte` renders a distinct **"Assigned by your coach"** section (name, move count, a **Train** link to `/learn`) above/below the player's own list; shown only when non-empty.

### 3. Learn queue — include assigned repertoires
`(player)/learn/+page.server.ts` currently builds `repIds` from `repertoires where player_id = self`. Change it to the union of:
- own repertoire ids, and
- assigned repertoire ids (`assigned_repertoires.repertoire_id where player_id = self`).

The rest (fetch moves `in repIds`, fetch reviews, compute due queue) is unchanged, so assigned moves enter the SRS queue and become drillable. Deduplicate ids (a repertoire could in principle be both, though not in practice).

## Data flow (assign → train → coach sees)
1. Coach assigns repertoire R to player P → `assigned_repertoires(player_id=P, coach_id=C, repertoire_id=R)`.
2. P opens `/repertoires` → sees R under "Assigned by your coach" (RLS policy #1 lets P read R).
3. P trains via `/learn` → R's moves are in the queue (RLS policy #2), reviews upsert with `player_id=P` (existing reviews RLS).
4. Coach's `/coach/players/[player_id]` reads P's `player_stats`/reviews (existing coach-read RLS) → sees progress. No change.

## Testing

- **Component test** (`repertoires` page or a small `AssignedRepertoires` section): renders the "Assigned by your coach" heading + an assigned repertoire's name when `assignedRepertoires` is non-empty; renders nothing/only own list when empty. (jsdom, mock data prop.)
- **Pure helper** (optional): if id-union logic is extracted (`mergeRepertoireIds(own, assigned)`), unit-test dedupe. Otherwise inline.
- **Manual smoke** (after migration applied): as a coach, assign a repertoire to a player; as that player, see it under "Assigned by your coach", open `/learn`, train a move; confirm the review persists; as the coach, see the player's updated stats.

## Risks

- **RLS recursion / performance:** the new policies query `assigned_repertoires` from `repertoires`/`moves` policies — `assigned_repertoires` policies don't query `repertoires`/`moves`, so no recursion. `exists` on an indexed `assigned_repertoires(player_id, repertoire_id)` is cheap; add nothing new (PK/unique already covers it).
- **Learn queue size:** assigned repertoires enlarge the move set; bounded by how many a coach assigns — fine for the SRS queue.
- **Migration is external:** the loop only works once `0017` is applied; until then the player sees no assigned section and `learn` excludes assigned moves (no error, just absent).
