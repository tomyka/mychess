-- mychess/supabase/migrations/0040_fix_assigned_repertoires_rls_recursion.sql
-- Fixes "infinite recursion detected in policy for relation
-- assigned_repertoires", hit whenever a coach assigns a repertoire to a
-- player (INSERT/UPDATE into assigned_repertoires).
--
-- Root cause: assigned_repertoires_coach_insert/_coach_update (0031,
-- carried over from 0030's ownership fix) verify the assigned repertoire
-- belongs to the assigning coach via a correlated subquery against
-- `repertoires`. That subquery is itself subject to repertoires' own RLS,
-- which includes repertoires_player_assigned_read (0017) — a policy that
-- queries assigned_repertoires back, so a player can read a repertoire
-- assigned to them. Postgres refuses to expand this cycle
-- (assigned_repertoires -> repertoires -> assigned_repertoires) and errors
-- out instead of resolving it, regardless of whether the specific policy
-- variants involved would actually terminate at runtime. 0017's own comment
-- ("not recursive: assigned_repertoires policies do not query
-- repertoires/moves") was true when written but was never rechecked once
-- 0030 added the ownership subquery the other direction.
--
-- Fix: check ownership via a `security definer` function instead of a plain
-- correlated subquery. Table owners bypass their own tables' row security
-- (no `force row level security` is set anywhere in this schema), and a
-- security definer function is never inlined by the planner, so calling one
-- from within a policy never triggers repertoires' policies at all —
-- breaking the cycle at its root rather than just moving it. Same technique
-- already used elsewhere in this schema for cross-cutting logic (e.g.
-- update_xp_and_level, update_weekly_leaderboard in 0003/0019).
create or replace function public.repertoire_owned_by(p_repertoire_id uuid, p_owner_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.repertoires r
    where r.id = p_repertoire_id and r.player_id = p_owner_id
  );
$$;

revoke all on function public.repertoire_owned_by(uuid, uuid) from public;
grant execute on function public.repertoire_owned_by(uuid, uuid) to authenticated;

drop policy assigned_repertoires_coach_insert on public.assigned_repertoires;
create policy assigned_repertoires_coach_insert on public.assigned_repertoires
  for insert with check (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
    and public.repertoire_owned_by(assigned_repertoires.repertoire_id, assigned_repertoires.coach_id)
  );

drop policy assigned_repertoires_coach_update on public.assigned_repertoires;
create policy assigned_repertoires_coach_update on public.assigned_repertoires
  for update using (coach_id = auth.uid())
  with check (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
    and public.repertoire_owned_by(assigned_repertoires.repertoire_id, assigned_repertoires.coach_id)
  );
