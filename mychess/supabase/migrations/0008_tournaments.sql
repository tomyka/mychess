-- Create tournaments table
create table if not exists public.tournaments (
  id text primary key default gen_random_uuid()::text,
  chess_results_id text unique not null,
  name text not null,
  country text not null default 'Lithuania',
  city text,
  start_date timestamptz,
  end_date timestamptz,
  time_control text not null default 'UNKNOWN',
  status text not null default 'NOT_STARTED',
  player_count integer,
  average_rating integer,
  round_count integer,
  chief_arbiter text,
  organizer text,
  url text not null,
  last_scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create indexes on tournaments
create index if not exists idx_tournaments_start_date on public.tournaments(start_date);
create index if not exists idx_tournaments_status on public.tournaments(status);
create index if not exists idx_tournaments_time_control on public.tournaments(time_control);
create index if not exists idx_tournaments_country on public.tournaments(country);

-- Create tournament_players table
create table if not exists public.tournament_players (
  id text primary key default gen_random_uuid()::text,
  tournament_id text not null references public.tournaments(id) on delete cascade,
  name text not null,
  fide_id text,
  rating integer,
  federation text,
  title text,
  rank integer,
  points numeric(4,1),
  unique (tournament_id, fide_id),
  unique (tournament_id, name, rank)
);

-- Create indexes on tournament_players
create index if not exists idx_tournament_players_tournament_id on public.tournament_players(tournament_id);
create index if not exists idx_tournament_players_fide_id on public.tournament_players(fide_id);

-- Create scrape_logs table
create table if not exists public.scrape_logs (
  id text primary key default gen_random_uuid()::text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  message text,
  tournaments_found integer not null default 0,
  tournaments_updated integer not null default 0
);

-- Enable RLS on all three tables
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.scrape_logs enable row level security;

-- Public read policy for tournaments
create policy "public read tournaments" on public.tournaments
  for select using (true);

-- Public read policy for tournament_players
create policy "public read tournament_players" on public.tournament_players
  for select using (true);

-- Service role only policy for scrape_logs (no public read)
create policy "service_role all scrape_logs" on public.scrape_logs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Create set_updated_at() trigger function if not exists
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Create trigger for tournaments updated_at
create trigger tournaments_updated_at
  before update on public.tournaments
  for each row
  execute function public.set_updated_at();
