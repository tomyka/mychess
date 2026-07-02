-- Customizable country-rank basis: per-user rating preference + per-rating rank
-- columns on the FIDE player cache.

-- 1. User preference: which rating drives the rank tiles.
alter table public.profiles
  add column if not exists rank_basis text not null default 'standard'
  check (rank_basis in ('standard', 'rapid', 'blitz'));

-- 2. Per-rating rank columns. age_bracket is rating-independent and stays.
alter table public.fide_players
  add column if not exists country_rank_standard   integer,
  add column if not exists country_rank_rapid      integer,
  add column if not exists country_rank_blitz      integer,
  add column if not exists age_group_rank_standard integer,
  add column if not exists age_group_rank_rapid    integer,
  add column if not exists age_group_rank_blitz    integer;

-- 3. Drop the old standard-only rank columns (replaced by *_standard above).
alter table public.fide_players drop column if exists country_rank;
alter table public.fide_players drop column if exists age_group_rank;
