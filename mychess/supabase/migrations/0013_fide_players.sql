-- FIDE Lithuania rank importer: player rating/rank cache + import audit log.

create table if not exists public.fide_players (
  fide_id        text primary key,
  name           text,
  federation     text not null,
  sex            text,
  birth_year     integer,
  std_rating     integer,
  rapid_rating   integer,
  blitz_rating   integer,
  country_rank   integer,
  age_bracket    text,
  age_group_rank integer,
  list_date      date,
  updated_at     timestamptz not null default now()
);

alter table public.fide_players enable row level security;

-- Ranks are public information: anyone (incl. anonymous guests) may read them.
drop policy if exists "fide_players public read" on public.fide_players;
create policy "fide_players public read"
  on public.fide_players for select using (true);
-- No insert/update/delete policies: only the service-role key (bypasses RLS) writes.

create table if not exists public.fide_import_logs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running',   -- running | success | partial | error
  message          text,
  players_imported integer,
  list_date        date
);

alter table public.fide_import_logs enable row level security;
-- No policies: service-role only.
