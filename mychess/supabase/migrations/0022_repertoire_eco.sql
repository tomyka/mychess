-- mychess/supabase/migrations/0022_repertoire_eco.sql
-- Adds ECO opening classification to repertoires. Both columns are nullable —
-- a repertoire with no detected/chosen opening is simply "Unclassified".
alter table public.repertoires
  add column eco_code text,
  add column eco_name text;
