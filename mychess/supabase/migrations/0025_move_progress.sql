-- mychess/supabase/migrations/0025_move_progress.sql
-- Tracks state per MOVE EDGE rather than per root-to-leaf variation
-- (replacing variation_progress's per-variation deepest-depth-reached model
-- for the new Practice/Master split — see
-- docs/superpowers/specs/2026-07-13-training-modes-redesign-design.md).
--
-- Repertoire lines share prefixes (the moves tree already models this —
-- multiple variations can share the same early edges before branching).
-- Tracking state on the edge itself means a shared trunk only ever needs to
-- be learned once; every variation sharing it benefits immediately, instead
-- of re-testing identical opening moves separately per branch.
--
-- A move starts 'new' and flips to 'correct' the instant it's played
-- correctly, in EITHER mode (Master or Practice) — this is the one shared
-- state store both modes read/write, so broad practice in Master also
-- advances a repertoire's structured levels in Practice, and vice versa.
--
-- variation_progress and reviews: kept, untouched, simply stop being
-- written to — matches this codebase's established non-destructive
-- convention rather than a destructive migration.
create table public.move_progress (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.profiles(id) on delete cascade,
  move_id    uuid not null references public.moves(id) on delete cascade,
  state      text not null default 'new' check (state in ('new', 'correct')),
  updated_at timestamptz not null default now(),
  unique(player_id, move_id)
);

alter table public.move_progress enable row level security;

create policy "move_progress_player_all" on public.move_progress
  for all using (player_id = auth.uid());

revoke all on public.move_progress from anon, public;
