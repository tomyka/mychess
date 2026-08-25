-- Supabase Security Advisor flags coach_directory and player_directory as
-- "SECURITY DEFINER" views: neither sets security_invoker=on, so both run
-- with their owner's privileges rather than the querying user's, bypassing
-- profiles' RLS -- deliberately, today, so an unconnected user can browse a
-- narrow 5-column slice (name + avatar) of other players'/coaches' profiles
-- to find someone to connect with.
--
-- A same-table fix doesn't work: RLS is row-scoped, not column-scoped, and
-- applies to every query against profiles regardless of which view reaches
-- it. Any policy broad enough to make these views work under
-- security_invoker=on (e.g. "any authenticated user can see any row where
-- role='coach'") would equally let any authenticated user query
-- public.profiles directly and get all 13 columns (including
-- chesscom_username, lichess_username, fide_id), not just the 5 the views
-- intend to expose.
--
-- Instead, decouple the browsable fields into their own table, kept in sync
-- via trigger, so a genuinely open RLS policy on IT is safe (it only ever
-- holds these 5 already-narrow, non-sensitive columns). The two views then
-- become real security_invoker=on views over it -- same output shape, so the
-- application call site (coach-players.ts) needs zero changes.
create table public.directory_profiles (
  id           uuid primary key references public.profiles(id) on delete cascade,
  role         text not null,
  first_name   text,
  last_name    text,
  display_name text not null,
  avatar_id    text not null
);

alter table public.directory_profiles enable row level security;

create policy directory_profiles_authenticated_read on public.directory_profiles
  for select using (true);

grant select on public.directory_profiles to authenticated;
revoke all on public.directory_profiles from anon, public;

-- One-time backfill for every profile that exists today.
insert into public.directory_profiles (id, role, first_name, last_name, display_name, avatar_id)
select id, role, first_name, last_name, display_name, avatar_id
from public.profiles
on conflict (id) do nothing;

-- security definer + pinned search_path, matching update_weekly_leaderboard
-- (migration 0019) -- ordinary users can UPDATE their own profiles row
-- (permitted by profiles' own RLS) but have no write grant on
-- directory_profiles at all; the trigger needs the owner's elevated
-- privileges to mirror that write through.
create or replace function public.sync_directory_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.directory_profiles (id, role, first_name, last_name, display_name, avatar_id)
  values (new.id, new.role, new.first_name, new.last_name, new.display_name, new.avatar_id)
  on conflict (id) do update set
    role = excluded.role,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    display_name = excluded.display_name,
    avatar_id = excluded.avatar_id;
  return new;
end;
$$;

create trigger profiles_sync_directory
  after insert or update of role, first_name, last_name, display_name, avatar_id
  on public.profiles
  for each row execute function public.sync_directory_profile();

-- Same 5 output columns, same shape as before -- only the FROM target and
-- the security_invoker option change. profiles.id -> directory_profiles.id
-- on delete cascade keeps this in sync when a profile is ever deleted, with
-- no separate delete trigger needed.
create or replace view public.coach_directory
  with (security_invoker = on) as
select id, first_name, last_name, display_name, avatar_id
from public.directory_profiles
where role = 'coach';

create or replace view public.player_directory
  with (security_invoker = on) as
select id, first_name, last_name, display_name, avatar_id
from public.directory_profiles
where role = 'player';

grant select on public.coach_directory to authenticated;
revoke all on public.coach_directory from anon, public;

grant select on public.player_directory to authenticated;
revoke all on public.player_directory from anon, public;

-- Belt-and-suspenders: explicitly (re)assert the option CREATE OR REPLACE
-- VIEW just set, since security_invoker is the entire point of this
-- migration and isn't worth leaving to inference.
alter view public.coach_directory set (security_invoker = on);
alter view public.player_directory set (security_invoker = on);
