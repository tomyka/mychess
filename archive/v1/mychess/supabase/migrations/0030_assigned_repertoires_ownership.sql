-- mychess/supabase/migrations/0030_assigned_repertoires_ownership.sql
-- Security fix: `coach_players_manage_assignments` (0019) only checked that
-- the coach has an ACTIVE relationship with the target player — it never
-- checked that the repertoire being assigned actually belongs to that coach.
-- Combined with 0017's `repertoires_player_assigned_read`/
-- `moves_player_assigned_read` (which trust `assigned_repertoires` rows
-- unconditionally), a coach could assign a repertoire UUID they don't own
-- — belonging to an unrelated coach or player — to one of their own active
-- students, who could then read that repertoire's content they were never
-- meant to have access to. The app layer (repertoires/+page.server.ts,
-- players/[player_id]/+page.server.ts) only ever shows a coach their own
-- repertoires in the assignment UI, but nothing at the DB layer stopped a
-- raw request with an arbitrary repertoire_id.
--
-- Fix: require the repertoire to actually belong to the assigning coach,
-- same ownership model already used everywhere else (repertoires.player_id
-- = the uploader/owner).
drop policy "coach_players_manage_assignments" on public.assigned_repertoires;
create policy coach_players_manage_assignments on public.assigned_repertoires
  for all using (
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
