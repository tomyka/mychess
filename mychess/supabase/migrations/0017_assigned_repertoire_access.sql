-- Coach -> player material loop: let a player read repertoires (and their moves)
-- that a coach assigned to them. Additive; existing owner/coach policies untouched.
-- Not recursive: assigned_repertoires policies do not query repertoires/moves.

create policy "repertoires_player_assigned_read" on public.repertoires
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = repertoires.id and a.player_id = auth.uid()
    )
  );

create policy "moves_player_assigned_read" on public.moves
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = moves.repertoire_id and a.player_id = auth.uid()
    )
  );
