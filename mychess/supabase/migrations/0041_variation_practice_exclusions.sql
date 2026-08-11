-- mychess/supabase/migrations/0041_variation_practice_exclusions.sql
-- Per-player "exclude this variation from practice" state. Presence of a row
-- means excluded; absence means included — so the default (nothing recorded)
-- is "everything selected" with zero rows to write at import time.
--
-- Keyed like variation_progress (player_id + variation_key, unique together):
-- a repertoire can be assigned by a coach to many students via
-- assigned_repertoires (same row, many players), so this can't be a column
-- on repertoires itself without one student's exclusion affecting everyone
-- else assigned the same repertoire.
create table public.variation_practice_exclusions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  created_at    timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_practice_exclusions_player_repertoire_idx
  on public.variation_practice_exclusions (player_id, repertoire_id);

alter table public.variation_practice_exclusions enable row level security;

create policy "variation_practice_exclusions_player_all" on public.variation_practice_exclusions
  for all using (player_id = auth.uid());

revoke all on public.variation_practice_exclusions from anon, public;
