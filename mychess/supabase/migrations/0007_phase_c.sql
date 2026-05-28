-- Phase C: platform username fields
alter table public.profiles
  add column if not exists chesscom_username text,
  add column if not exists lichess_username  text;
