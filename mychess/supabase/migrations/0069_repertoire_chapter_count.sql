-- mychess/supabase/migrations/0069_repertoire_chapter_count.sql
--
-- #105: caches each repertoire's chapter count (masterableChapters(variations)
-- .length — every chapter tier, or a single implicit UNTAGGED_CHAPTER bucket
-- for a repertoire with no chapter tags at all) so the repertoire list can
-- show a Mastered badge via a cheap count comparison against this player's
-- current chapter_mastery rows, without enumerating variations on every list
-- load. Nullable — null means "not yet computed", backfilled lazily on next
-- load (loadRepertoireProgressSummaries), the same self-healing pattern as
-- total_variations (0036) and has_chapters (0043).
alter table public.repertoires add column chapter_count integer;

-- Threaded through apply_repertoire_update (0063) alongside the two existing
-- cached-shape columns it already refreshes, so a coach re-upload can't leave
-- this stale the way it would if only the lazy null-backfill ever wrote it.
-- `create or replace` cannot change an argument list (it creates a second
-- overload), so the prior 6-argument version is dropped explicitly first —
-- same precaution 0063 itself took over the 5-argument version before it.
drop function if exists public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean);

create or replace function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_unretire_move_ids uuid[],
  p_chapter_renames jsonb,
  p_total_variations int,
  p_has_chapters boolean,
  p_chapter_count int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_rename jsonb;
begin
  select player_id into v_owner
  from public.repertoires
  where id = p_repertoire_id
  for update;

  if not found then
    raise exception 'Repertoire % not found', p_repertoire_id;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  if v_owner is distinct from auth.uid()
     and not exists (
       select 1
       from public.coach_players cp
       where cp.player_id = v_owner
         and cp.coach_id = auth.uid()
         and cp.status = 'active'
     )
  then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  if jsonb_typeof(p_chapter_renames) = 'array' then
    for v_rename in select value from jsonb_array_elements(p_chapter_renames) loop
      if (v_rename ->> 'from') is not null and (v_rename ->> 'to') is not null then
        update public.moves
          set chapter_names = array_replace(
                chapter_names,
                (v_rename ->> 'from')::text,
                (v_rename ->> 'to')::text
              )
          where repertoire_id = p_repertoire_id
            and chapter_names @> array[(v_rename ->> 'from')::text];
      end if;
    end loop;
  end if;

  if array_length(p_retire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = now()
      where repertoire_id = p_repertoire_id
        and id = any(p_retire_move_ids)
        and retired_at is null;
  end if;

  if array_length(p_unretire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = null
      where repertoire_id = p_repertoire_id
        and id = any(p_unretire_move_ids)
        and retired_at is not null;
  end if;

  -- Refresh the cached shape (migrations 0036 / 0043 / 0069). Computed by the
  -- caller from the new PGN, since it already walked the tree to produce the
  -- diff.
  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters,
        chapter_count = p_chapter_count,
        update_in_progress_at = null
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int) to authenticated;
