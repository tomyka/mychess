-- mychess/supabase/migrations/0080_narrow_apply_update_and_opening_source.sql
--
-- Two changes the removal of the re-upload subsystem (#211) left owing.
--
-- ===========================================================================
-- 1. #213 — apply_repertoire_update loses two permanently dead parameters
-- ===========================================================================
--
-- `p_unretire_move_ids` and `p_chapter_renames` existed for the coach
-- re-upload. That flow is gone, and its only surviving caller — the chapter
-- manager — passes '{}' and '[]' on every call, forever. Both branches are
-- therefore unreachable, and so is the `array_replace` rename loop.
--
-- Retiring is one-way as a result, which is stated at `fetchLiveMoves` in
-- src/lib/server/moves.ts rather than left for someone to rediscover. Nothing
-- here changes that; it only stops pretending the reverse is wired up.
--
-- ON DROPPING SAFELY. `create or replace` cannot change an argument list, so
-- the old function must be dropped first — and a drop naming the wrong
-- signature leaves the old overload in place beside the new one, which makes
-- every call ambiguous at runtime. 0074 guarded that by listing the two
-- signatures it knew about. This migration cannot: it was written without a
-- way to inspect the live catalogue, and CLAUDE.md records that migrations
-- here have drifted from the deployed schema more than once.
--
-- So instead of naming signatures, it drops EVERY overload of the name from
-- pg_proc. That is exact regardless of what is actually deployed, and it
-- makes re-running this migration safe.

do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'apply_repertoire_update'
  loop
    execute 'drop function ' || v_sig;
  end loop;
end $$;

create function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_total_variations int,
  p_has_chapters boolean,
  p_chapter_count int,
  -- Still defaulted, though the one caller always passes it: a removal that
  -- retires moves without naming chapters is a coherent call, and defaulting
  -- keeps that shape available without a second overload.
  p_remove_chapters text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
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

    -- Needs this function's `security definer`:
    -- variation_chapter_practice_exclusions' RLS is `player_id = auth.uid()`
    -- and these rows belong to other players.
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

  -- Refresh the cached shape (migrations 0036 / 0043 / 0069). Computed by the
  -- caller, which already walked the tree to produce the removal plan.
  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters,
        chapter_count = p_chapter_count,
        update_in_progress_at = null
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], int, boolean, int, text[]) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], int, boolean, int, text[]) to authenticated;

-- ===========================================================================
-- 2. #209 — a coach could not activate a student's own upload
-- ===========================================================================
--
-- `active_opening_repertoires_insert` (0079) already permits it: the rule is
-- `manages_openings_for(player_id) and repertoire_available_to(...)`, and a
-- repertoire the student uploaded satisfies both. But the server has to
-- resolve which curated opening the repertoire prepares BEFORE it can write
-- the row, and it read the repertoire through the caller's own client —
-- where `repertoires`' RLS does not let a coach see a student's own upload.
-- The write was allowed and the read that precedes it was not, so the coach
-- got "Repertoire not found".
--
-- This is the read, gated on exactly the predicates the write policy uses, so
-- the two cannot disagree. It exposes only the four columns `resolveOpening`
-- needs — no positions, no moves, no notes — so it widens what a coach may
-- learn about a student's material by nothing that matters: which opening it
-- prepares is precisely what they are about to record.
create or replace function public.repertoire_opening_source(p_repertoire_id uuid, p_player_id uuid)
returns table (id uuid, eco_code text, color text, opening_id text)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.eco_code, r.color, r.opening_id
  from public.repertoires r
  where r.id = p_repertoire_id
    and public.manages_openings_for(p_player_id)
    and public.repertoire_available_to(p_repertoire_id, p_player_id);
$$;

revoke all on function public.repertoire_opening_source(uuid, uuid) from anon, public;
grant execute on function public.repertoire_opening_source(uuid, uuid) to authenticated;
