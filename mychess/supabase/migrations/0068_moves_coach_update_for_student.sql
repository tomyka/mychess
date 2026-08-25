-- #123: a coach importing a multi-chapter PGN into a student-owned
-- repertoire can INSERT new move rows (moves_coach_insert_for_student,
-- migration 0020) but has no UPDATE grant, so writeMoves's
-- `onConflict: 'repertoire_id,from_position,san'` upsert fails under RLS
-- whenever two chapters share a prefix edge and the chapter_names merge
-- hits the UPDATE path (pgn-import.ts's `writeMoves`). Not reachable when
-- the coach owns the repertoire themselves (moves_player_all already
-- covers that), which is why this went unnoticed.
--
-- Mirrors moves_coach_insert_for_student's predicate exactly, including its
-- `cp.status = 'active'` anti-hijack guard, so a coach can only update moves
-- on a repertoire whose owner they currently have an active relationship
-- with — same as insert already requires.

create policy moves_coach_update_for_student on public.moves
  for update using (
    exists (
      select 1 from public.repertoires r
      join public.coach_players cp on cp.player_id = r.player_id and cp.status = 'active'
      where r.id = moves.repertoire_id and cp.coach_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.repertoires r
      join public.coach_players cp on cp.player_id = r.player_id and cp.status = 'active'
      where r.id = moves.repertoire_id and cp.coach_id = auth.uid()
    )
  );
