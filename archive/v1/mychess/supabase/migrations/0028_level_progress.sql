-- mychess/supabase/migrations/0028_level_progress.sql
-- Explicit, persisted per-(player, repertoire) leveling run — replaces
-- move_progress-derived leveling for Practice (see
-- docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
--
-- Unlike move_progress's permanent "ever correct" fact set, the new rules
-- (a 3-strikes demotion counter, a FIFO-with-requeue task queue, "mastered
-- only with zero mistakes this run") are inherently sequential and can't be
-- recovered from a snapshot of history — this table stores the run
-- explicitly instead of deriving it.
--
-- move_progress: kept, untouched, simply stops being written to — matches
-- this codebase's established non-destructive convention.
create table public.level_progress (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.profiles(id) on delete cascade,
  repertoire_id       uuid not null references public.repertoires(id) on delete cascade,
  level               int not null default 1,
  prev_level_mistakes int not null default 0,
  queue               jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  unique(player_id, repertoire_id)
);

alter table public.level_progress enable row level security;

create policy "level_progress_player_all" on public.level_progress
  for all using (player_id = auth.uid());

revoke all on public.level_progress from anon, public;
