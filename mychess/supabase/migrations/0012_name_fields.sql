-- Add first_name and last_name fields for FIDE validation integration
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;
