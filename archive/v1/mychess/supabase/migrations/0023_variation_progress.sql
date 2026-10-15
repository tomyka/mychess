-- Tracks, per player and per variation, the deepest point the player has
-- successfully played through. Levels are derived from this single number
-- at query time, not stored separately.
--
-- A variation is identified by `variation_key` (the full ordered sequence of
-- move ids along its path, joined by '>'), NOT by leaf_move_id alone: if a
-- repertoire merges games that transpose into a shared position, two
-- genuinely different paths can converge and share an identical tail,
-- ending on the same leaf move. leaf_move_id is kept purely as an
-- informational FK to the variation's final move (e.g. for debugging),
-- not as the uniqueness key.
create table public.variation_progress (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles(id) on delete cascade,
  repertoire_id         uuid not null references public.repertoires(id) on delete cascade,
  leaf_move_id          uuid not null references public.moves(id) on delete cascade,
  variation_key         text not null,
  deepest_depth_reached int not null default 0,
  updated_at            timestamptz not null default now(),
  unique(player_id, variation_key)
);

alter table public.variation_progress enable row level security;

create policy "variation_progress_player_all" on public.variation_progress
  for all using (player_id = auth.uid());

revoke all on public.variation_progress from anon, public;
