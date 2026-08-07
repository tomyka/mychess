-- mychess/supabase/migrations/0031_fix_assigned_repertoires_read_regression.sql
-- Regression fix: 0030 replaced assigned_repertoires' policy with a single
-- `for all` USING clause that added an ownership EXISTS check against
-- `repertoires` — correct for blocking a coach from assigning a repertoire
-- they don't own, but because it's `for all` it also gated SELECT. A player
-- reading their own assigned_repertoires rows runs that EXISTS under their
-- own RLS context, where `repertoires` only exposes rows they themselves
-- own (repertoires_player_all) — the coach's repertoire row is invisible to
-- them, so the EXISTS always evaluated false. Result: every assigned
-- repertoire silently vanished (empty result, no error) from every player's
-- `/repertoires` and `/practice` pages, and — since moves_player_assigned_read
-- (0017) subqueries assigned_repertoires the same way — their moves too.
--
-- Fix: split by operation. SELECT goes back to the pre-0030 relationship-only
-- check (safe: coach_players itself is RLS-scoped to its two participants, so
-- this still only ever matches rows the querying user is actually part of).
-- The ownership check moves to INSERT/UPDATE only, where it belongs — that's
-- the actual point of assignment, the only place the original vulnerability
-- (assigning a repertoire you don't own) could occur.
drop policy "coach_players_manage_assignments" on public.assigned_repertoires;

create policy assigned_repertoires_participant_read on public.assigned_repertoires
  for select using (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
  );

-- Covers both a fresh assign and the upsert's ON CONFLICT DO UPDATE path
-- (re-assigning), both driven only by the coach.
create policy assigned_repertoires_coach_insert on public.assigned_repertoires
  for insert with check (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
    and exists (
      select 1 from public.repertoires r
      where r.id = assigned_repertoires.repertoire_id
        and r.player_id = assigned_repertoires.coach_id
    )
  );

create policy assigned_repertoires_coach_update on public.assigned_repertoires
  for update using (coach_id = auth.uid())
  with check (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
    and exists (
      select 1 from public.repertoires r
      where r.id = assigned_repertoires.repertoire_id
        and r.player_id = assigned_repertoires.coach_id
    )
  );

-- Unassigning is always done by the coach (both call sites filter on
-- coach_id = auth.uid()) — no need for the relationship/ownership checks here.
create policy assigned_repertoires_coach_delete on public.assigned_repertoires
  for delete using (coach_id = auth.uid());
