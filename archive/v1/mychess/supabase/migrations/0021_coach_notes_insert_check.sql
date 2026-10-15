-- coach_notes_coach_all was a single for-all policy with no explicit insert
-- check, so its using expression (coach_id = auth.uid()) doubled as the
-- insert check — meaning any coach could insert a note attached to ANY
-- player, not just a connected student. This was reachable for the first
-- time once the coach student-detail page's "leave a note" form shipped.
-- Split the policy by operation: select/update/delete stay exactly as
-- permissive as before (so a coach keeps access to notes for a student
-- they've since unlinked from, matching this project's "keep past
-- assignments" precedent for unlinking), but insert now requires an active
-- coach_players relationship.

drop policy "coach_notes_coach_all" on public.coach_notes;

create policy coach_notes_coach_read on public.coach_notes
  for select using (coach_id = auth.uid());

create policy coach_notes_coach_update on public.coach_notes
  for update using (coach_id = auth.uid());

create policy coach_notes_coach_delete on public.coach_notes
  for delete using (coach_id = auth.uid());

create policy coach_notes_coach_insert on public.coach_notes
  for insert with check (
    coach_id = auth.uid()
    and exists (
      select 1 from public.coach_players cp
      where cp.coach_id = auth.uid() and cp.player_id = coach_notes.player_id and cp.status = 'active'
    )
  );
