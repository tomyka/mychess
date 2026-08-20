-- Analysis feature: one row per uploaded game, single-game/mainline-only for v1.
-- `create table if not exists` makes this safe to run again in production, where
-- the bare `create table` (no RLS) already ran out-of-band.
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id) on delete cascade,
  pgn text not null,
  headers jsonb not null,
  played_as text check (played_as in ('white', 'black')),
  moves jsonb not null,
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'done')),
  analysis jsonb,
  created_at timestamptz not null default now()
);

alter table games enable row level security;

-- Split into single-operation policies (a broad `for all` alongside a
-- narrower same-operation policy would silently defeat the narrower one,
-- per CLAUDE.md) — not needed here since every operation has the same
-- owner-only rule, but kept split for consistency with the rest of the schema.
create policy games_select_own on games for select using (player_id = auth.uid());
create policy games_insert_own on games for insert with check (player_id = auth.uid());
create policy games_update_own on games for update using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy games_delete_own on games for delete using (player_id = auth.uid());

revoke all on games from anon, public;
