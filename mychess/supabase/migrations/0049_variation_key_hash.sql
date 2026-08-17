-- mychess/supabase/migrations/0049_variation_key_hash.sql
-- variation_key is an unbounded `>`-joined chain of move UUIDs (see
-- enumerateVariations in $lib/mastery/variations) — a deep opening line
-- (dozens of plies, as in a long reference/study PGN) produces a key long
-- enough to exceed Postgres's own btree index row-size limit when it's
-- inserted into a unique(player_id, variation_key) index. Confirmed in
-- production (mychess.lt, Aug 2026):
--
--   index row size 3432 exceeds btree version 4 maximum 2704 for index
--   "variation_practice_exclusions_player_id_variation_key_key"
--
-- This silently breaks any write keyed on a long enough variation_key —
-- not just variation_practice_exclusions (which at least surfaces a 400 to
-- the client), but also variation_solved and variation_teaching_progress,
-- whose upserts (markVariationSolved/saveTeachingProgress in
-- $lib/server/practice-progress.ts) are fire-and-forget: a deep variation's
-- solved/teaching-progress state would fail to persist with no error ever
-- shown to the player.
--
-- Fix: add a fixed-length sha256 hash of variation_key as a generated
-- column on each table, and move each table's uniqueness constraint onto
-- (player_id, variation_key_hash) instead of the raw text. variation_key
-- itself is untouched (still the source of truth for what a row means) —
-- only what backs the uniqueness index changes. A hash collision is
-- practically impossible (2^-256), and 64 hex characters comfortably fits
-- under the same btree limit regardless of how deep any future line runs.
--
-- pgcrypto (for digest()) already exists in most Supabase projects by
-- default (used by gen_random_uuid() and friends); this migration also
-- ensures it explicitly in case it's ever missing.
-- Written idempotently (add column if not exists / drop constraint if
-- exists / conditional add constraint) because this migration spans THREE
-- tables in sequence: a first attempt that failed partway through — e.g. on
-- `column "variation_key_hash" ... already exists`, which is what happens
-- when it's re-run after any earlier partial success — otherwise leaves the
-- later tables un-migrated with no safe way to resume. Postgres has no
-- `add constraint if not exists`, hence the DO blocks. Safe to run any
-- number of times, on a fresh or partially-migrated database.
create extension if not exists pgcrypto;

alter table public.variation_practice_exclusions
  add column if not exists variation_key_hash text generated always as (encode(digest(variation_key, 'sha256'), 'hex')) stored;

alter table public.variation_practice_exclusions
  drop constraint if exists variation_practice_exclusions_player_id_variation_key_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'variation_practice_exclusions_player_id_variation_key_hash_key'
  ) then
    alter table public.variation_practice_exclusions
      add constraint variation_practice_exclusions_player_id_variation_key_hash_key
      unique (player_id, variation_key_hash);
  end if;
end $$;

alter table public.variation_solved
  add column if not exists variation_key_hash text generated always as (encode(digest(variation_key, 'sha256'), 'hex')) stored;

alter table public.variation_solved
  drop constraint if exists variation_solved_player_id_variation_key_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'variation_solved_player_id_variation_key_hash_key'
  ) then
    alter table public.variation_solved
      add constraint variation_solved_player_id_variation_key_hash_key
      unique (player_id, variation_key_hash);
  end if;
end $$;

alter table public.variation_teaching_progress
  add column if not exists variation_key_hash text generated always as (encode(digest(variation_key, 'sha256'), 'hex')) stored;

alter table public.variation_teaching_progress
  drop constraint if exists variation_teaching_progress_player_id_variation_key_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'variation_teaching_progress_player_id_variation_key_hash_key'
  ) then
    alter table public.variation_teaching_progress
      add constraint variation_teaching_progress_player_id_variation_key_hash_key
      unique (player_id, variation_key_hash);
  end if;
end $$;
