-- mychess/supabase/migrations/0046_variation_teaching_progress.sql
-- Backs the "yellow arrow" teaching pass (see
-- docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md):
-- two ply-depth counters per (player, variation) that a pure function
-- (resolveTeachingStep/advanceTeachingProgress in src/lib/mastery/teaching.ts)
-- turns into "how deep to serve this attempt, and which ply range (if any)
-- gets an arrow." No row for a variation means "nothing beyond the free
-- zone taught or mastered yet" — that module floors both counters up to
-- the free zone on every read, so a missing row needs no special-casing.
create table public.variation_teaching_progress (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  variation_key  text not null,
  taught_plies   integer not null default 0,
  mastered_plies integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_teaching_progress_player_repertoire_idx
  on public.variation_teaching_progress (player_id, repertoire_id);

alter table public.variation_teaching_progress enable row level security;

create policy "variation_teaching_progress_player_all" on public.variation_teaching_progress
  for all using (player_id = auth.uid());

create policy variation_teaching_progress_coach_read on public.variation_teaching_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_teaching_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_teaching_progress from anon, public;
