-- mychess/supabase/migrations/0039_move_attempts.sql
-- Per-move attempt log for Practice, powering the coach-facing practice
-- report (see docs/superpowers/specs/2026-08-11-coach-practice-reports-design.md).
-- Practice previously persisted only an aggregate run-state row
-- (level_progress) — no individual move was ever recorded anywhere.
create table public.move_attempts (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  move_id       uuid not null references public.moves(id) on delete cascade,
  played_san    text not null,
  is_correct    boolean not null,
  level         smallint not null,
  created_at    timestamptz not null default now()
);

create index move_attempts_player_repertoire_created_idx
  on public.move_attempts (player_id, repertoire_id, created_at);
create index move_attempts_move_idx on public.move_attempts (move_id);

alter table public.move_attempts enable row level security;

create policy move_attempts_player_insert on public.move_attempts for insert
  with check (player_id = auth.uid());

create policy move_attempts_player_read on public.move_attempts for select
  using (player_id = auth.uid());

create policy move_attempts_coach_read on public.move_attempts for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = move_attempts.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.move_attempts from anon, public;

-- level_progress (0028_level_progress.sql) only ever granted the owning
-- player read/write access ("level_progress_player_all") — no coach-read
-- policy exists. The practice report's per-repertoire mastery display needs
-- a coach to read an active student's level_progress row, the same way
-- reviews_coach_read (0019_coach_players.sql) already does for the legacy
-- reviews table.
create policy level_progress_coach_read on public.level_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = level_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);
