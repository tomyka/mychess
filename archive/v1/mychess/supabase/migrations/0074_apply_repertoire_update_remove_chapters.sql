-- mychess/supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql
--
-- #184: a coach removing a chapter from an existing repertoire. Removal IS a
-- repertoire update — it retires moves exactly as a re-upload omitting those
-- chapters does — so it reuses apply_repertoire_update (0063, extended by
-- 0069) rather than growing a parallel RPC with its own copy of the auth
-- block, the row lock and the shape refresh.
--
-- Two new steps, both driven by the new p_remove_chapters argument:
--
--   1. Strip the removed names from every move that carries one. A move left
--      with no names at all is exactly a move the caller already listed in
--      p_retire_move_ids (see planChapterRemoval in
--      $lib/repertoire-chapter-removal.ts), so the two steps agree by
--      construction rather than by one inferring the other.
--   2. Delete the now-orphaned per-chapter practice exclusions, across EVERY
--      player. This genuinely needs the function's `security definer`:
--      variation_chapter_practice_exclusions' RLS is `player_id = auth.uid()`
--      and these rows belong to other players. Beyond tidiness it stops a
--      chapter resurrected by a later re-upload from coming back PRE-HIDDEN
--      for whichever students had unchecked it.
--
-- The strip itself is no longer an RLS problem — 0068 gave a coach UPDATE on
-- the moves of a student-owned repertoire. It lives here for ATOMICITY: it
-- lands in the same call, under the same `select … for update` row lock, as
-- the retires and the cached-shape refresh. Split app-side, a failure between
-- the two leaves chapter_names stripped with a stale shape, or vice versa.
--
-- `create or replace` cannot change an argument list (it creates a second
-- overload), so prior versions are dropped explicitly first — the same
-- precaution 0063 and 0069 each took. Both the 7-argument version this
-- replaces AND the 8-argument version this creates are dropped, so re-running
-- this migration is safe and can never leave two overloads behind (an
-- ambiguous-function error at call time, which is a confusing way to discover
-- a double-applied migration).
drop function if exists public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int);
drop function if exists public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int, text[]);

create or replace function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_unretire_move_ids uuid[],
  p_chapter_renames jsonb,
  p_total_variations int,
  p_has_chapters boolean,
  p_chapter_count int,
  -- Defaulted so the existing re-upload apply call site (which passes seven
  -- named arguments and knows nothing about chapter removal) keeps working
  -- untouched. Do NOT add this argument to that call site.
  p_remove_chapters text[] default '{}'::text[]
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

  -- Renames run FIRST, deliberately: a rename maps an old name onto a new one,
  -- and the caller computed p_remove_chapters against the repertoire's CURRENT
  -- names. A removal request never carries renames (the chapters route passes
  -- an empty array), so the two never interact in practice — but if they ever
  -- did, removing after renaming is the order that matches what the caller was
  -- looking at.
  if array_length(p_remove_chapters, 1) > 0 then
    -- array_agg over an empty set returns NULL, not '{}' — hence the coalesce.
    -- Without it a move losing its last name would get a NULL chapter_names,
    -- which enumerateVariations reads as "untagged" rather than "gone", and the
    -- line would reappear in the untagged bucket instead of disappearing.
    update public.moves
      set chapter_names = coalesce(
            (select array_agg(n) from unnest(chapter_names) n where n <> all(p_remove_chapters)),
            '{}'::text[]
          )
      where repertoire_id = p_repertoire_id
        and chapter_names && p_remove_chapters;

    delete from public.variation_chapter_practice_exclusions
      where repertoire_id = p_repertoire_id
        and chapter_name = any(p_remove_chapters);
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
  -- caller, which already walked the tree to produce the diff or the removal
  -- plan.
  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters,
        chapter_count = p_chapter_count,
        update_in_progress_at = null
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int, text[]) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int, text[]) to authenticated;
