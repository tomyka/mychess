-- mychess/supabase/migrations/0045_remove_leveling_add_solved.sql
-- Removes leveling/chunking from Practice entirely (see
-- docs/superpowers/plans/2026-08-13-remove-leveling-add-variation-picker.md)
-- and replaces it with two simpler concepts:
--
-- 1. practice_active_variation: which ONE variation a player is currently
--    drilling for a repertoire — same idea as level_progress.active_variation_key,
--    now on its own table with nothing else attached to it. No optimistic-
--    concurrency version column: unlike the old level/queue state (which
--    could be corrupted by two concurrent writers disagreeing on level
--    math), a plain last-write-wins on "which key is active" is a benign
--    outcome even under a genuine race — worst case one of two near-
--    simultaneous picks briefly loses to the other.
-- 2. variation_solved: a permanent, presence-based fact ("this player has
--    replayed this variation cleanly at least once") — mirrors the existing
--    variation_practice_exclusions table's presence-means-X pattern. Once a
--    row exists it is never deleted by the app; solved is a one-way flag.
drop table if exists public.level_progress;

create table public.practice_active_variation (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.profiles(id) on delete cascade,
  repertoire_id       uuid not null references public.repertoires(id) on delete cascade,
  active_variation_key text,
  updated_at          timestamptz not null default now(),
  unique (player_id, repertoire_id)
);

alter table public.practice_active_variation enable row level security;

create policy "practice_active_variation_player_all" on public.practice_active_variation
  for all using (player_id = auth.uid());

create policy practice_active_variation_coach_read on public.practice_active_variation for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = practice_active_variation.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.practice_active_variation from anon, public;

create table public.variation_solved (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  solved_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_solved_player_repertoire_idx
  on public.variation_solved (player_id, repertoire_id);

alter table public.variation_solved enable row level security;

create policy "variation_solved_player_all" on public.variation_solved
  for all using (player_id = auth.uid());

create policy variation_solved_coach_read on public.variation_solved for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_solved.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_solved from anon, public;

-- Leveling-specific repertoire columns — nothing reads these once this plan
-- lands. total_variations stays (still a valid cached count, unrelated to
-- leveling).
alter table public.repertoires drop column if exists chunk_size;
alter table public.repertoires drop column if exists practice_depth_levels;
alter table public.repertoires drop column if exists total_levels;
alter table public.repertoires drop column if exists level1_task_count;

-- Write-only column: confirmed by reading src/lib/server/practice-report.ts
-- that no report query ever selects move_attempts.level. Safe to drop outright.
alter table public.move_attempts drop column if exists level;
