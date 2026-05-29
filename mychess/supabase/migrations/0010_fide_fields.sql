-- mychess/supabase/migrations/0010_fide_fields.sql
alter table profiles add column if not exists fide_id text;
alter table profiles add column if not exists fide_rating integer;
