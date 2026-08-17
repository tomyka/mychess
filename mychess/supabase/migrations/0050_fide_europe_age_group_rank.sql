-- mychess/supabase/migrations/0050_fide_europe_age_group_rank.sql
-- Adds the Europe-wide, age-bracket-scoped rank columns. Computed from the
-- same monthly import as the existing country/age-group ranks, but scored
-- against all European-federation players (see src/lib/fide/federations.ts)
-- rather than just Lithuania. Only Lithuanian rows are ever stored here —
-- this does not grow fide_players' row count.
alter table public.fide_players
  add column if not exists europe_age_group_rank_standard integer,
  add column if not exists europe_age_group_rank_rapid    integer,
  add column if not exists europe_age_group_rank_blitz    integer;
