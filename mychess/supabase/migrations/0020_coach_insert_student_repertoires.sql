-- A coach could already READ a connected student's repertoires
-- (repertoires_coach_read, migration 0019) but had no way to CREATE one on
-- their behalf: repertoires_player_all's insert check requires
-- player_id = auth.uid(), which only ever matches the coach's own id, never
-- a student's. This surfaced as "new row violates row-level security policy
-- for table repertoires" the moment the coach's Upload Repertoire tool
-- assigned to an actual student instead of "Myself". Same gap exists on
-- moves, the very next insert in the same import flow.

create policy repertoires_coach_insert_for_student on public.repertoires
  for insert with check (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = auth.uid() and cp.player_id = repertoires.player_id and cp.status = 'active'
    )
  );

create policy moves_coach_insert_for_student on public.moves
  for insert with check (
    exists (
      select 1 from public.repertoires r
      join public.coach_players cp on cp.player_id = r.player_id and cp.status = 'active'
      where r.id = moves.repertoire_id and cp.coach_id = auth.uid()
    )
  );
