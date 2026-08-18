-- mychess/supabase/migrations/0055_exclusion_freshness.sql
--
-- Lets `loadRepertoireProgressSummaries` compute a player's filtered
-- variation total by SUBTRACTION (`total_variations - <live exclusions>`)
-- instead of re-fetching every move row and re-walking the variation tree on
-- every dashboard/picker load. See GitHub issue #52.
--
-- Why subtraction wasn't already possible: a `variation_practice_exclusions`
-- row's `variation_key` can go STALE. Keys are `>`-joined chains of move
-- UUIDs ending at a line's leaf, so appending a chapter to a repertoire can
-- extend what used to be a leaf — the old key then names a line that no
-- longer exists, and subtracting it would under-count. That's why the read
-- path filtered (`filterVariations`) rather than subtracted, and why it paid
-- a full move fetch to do so.
--
-- Staleness also already skewed the Practice picker: `excludedVariationCount`
-- was reported as the raw row count while `total` was filtered, so with any
-- stale row the two could sum past the repertoire's true variation count and
-- the repertoire-level checkbox rendered the wrong state. Verifying keys
-- fixes that too, so this is a correctness change as well as a perf one.
--
-- The approach: track when a repertoire's move set last changed, and when
-- each exclusion row was last checked against it. Equal (or newer) means the
-- row is known to name a live variation, so the read path can subtract. A
-- repertoire whose exclusions are behind gets ONE move fetch, which prunes
-- the stale rows and stamps the survivors — the same self-healing shape as
-- the existing `total_variations` backfill, and per-player, so it works
-- under `variation_practice_exclusions_player_all`'s RLS with no elevated
-- privileges (each player only ever rewrites their own rows).

-- Defaults are deliberately asymmetric, and that asymmetry is what makes
-- existing data safe: every repertoire is stamped as having changed *now*,
-- while every existing exclusion row is stamped 'epoch' ("never verified").
-- So nothing is assumed live at deploy time — each player's first load per
-- repertoire verifies once, exactly as if the shape had just changed.
alter table public.repertoires
  add column if not exists moves_updated_at timestamptz not null default now();

-- 'epoch' stays the permanent default, not just a backfill value: a freshly
-- inserted exclusion row has NOT been checked against the live shape either.
-- `validateVariationKeysOwnership` (the exclusions endpoint's write-time
-- check) confirms the referenced moves belong to the repertoire — which is
-- not the same as confirming the key still names a leaf path — and the keys
-- a client submits came from whatever shape its page was loaded against.
-- Certifying rows at write time would mean reasoning about that window plus
-- an import landing mid-request; leaving certification to the read path
-- costs one move fetch after an exclusion change and needs no such
-- reasoning to be correct.
alter table public.variation_practice_exclusions
  add column if not exists verified_at timestamptz not null default 'epoch';

-- Maintained by trigger rather than by the import code on purpose. The app
-- writes moves in per-chapter batches and only computes the repertoire's
-- shape on the LAST one (`writeMoves`' `finalize` param); a multi-chapter
-- import that's abandoned partway leaves moves committed with no finalize
-- ever running. An app-side bump in the finalize step would miss exactly
-- that case, and the miss is silent: exclusion rows would keep looking
-- verified against a shape that had already moved on. In-database, no move
-- write can escape it, and it costs one small UPDATE per statement rather
-- than a round trip per chapter.
--
-- security definer because the trigger has to update `repertoires` on behalf
-- of whoever wrote the moves, and its effect is not caller-controlled: it
-- stamps `now()` on exactly the repertoires whose own rows the statement
-- touched, taking no arguments. `search_path` is pinned per Supabase's
-- linter guidance for definer functions.
create or replace function public.touch_repertoire_moves_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Branches on TG_OP because a trigger may only reference the transition
  -- table it declares (`old_rows` exists on the delete trigger, `new_rows`
  -- on insert/update); plpgsql resolves these at execution, so the untaken
  -- branch's name never has to exist.
  if tg_op = 'DELETE' then
    update public.repertoires
      set moves_updated_at = now()
      where id in (select distinct repertoire_id from old_rows);
  else
    update public.repertoires
      set moves_updated_at = now()
      where id in (select distinct repertoire_id from new_rows);
  end if;
  return null;
end $$;

drop trigger if exists moves_touch_repertoire_insert on public.moves;
create trigger moves_touch_repertoire_insert
  after insert on public.moves
  referencing new table as new_rows
  for each statement execute function public.touch_repertoire_moves_updated_at();

-- Fires on update too. A chapter-merge upsert only rewrites `chapter_names`
-- and leaves keys alone, so this is conservative — it can force a
-- verification that turns out to prune nothing. Being conservative here is
-- the right trade: a missed bump is silently wrong, a spurious one costs a
-- single move fetch.
drop trigger if exists moves_touch_repertoire_update on public.moves;
create trigger moves_touch_repertoire_update
  after update on public.moves
  referencing new table as new_rows
  for each statement execute function public.touch_repertoire_moves_updated_at();

drop trigger if exists moves_touch_repertoire_delete on public.moves;
create trigger moves_touch_repertoire_delete
  after delete on public.moves
  referencing old table as old_rows
  for each statement execute function public.touch_repertoire_moves_updated_at();
