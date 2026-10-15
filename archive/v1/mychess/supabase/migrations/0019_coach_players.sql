-- Replaces the single-coach-per-player model (profiles.coach_id) with a
-- many-to-many coach<->player relationship. Two ways to form a relationship:
--   1. Invite-link redemption (existing flow) — inserted directly as
--      'active' via a service-role client (see join/[token]/+page.server.ts),
--      since redemption already proves both sides' consent.
--   2. Direct request — either side requests the other (status='pending',
--      requested_by=the requester), the other side accepts (-> 'active') or
--      declines (row deleted).

create table public.coach_players (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles(id),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  status        text not null check (status in ('pending', 'active')),
  requested_by  uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (coach_id, player_id),
  check (coach_id <> player_id)
);
alter table public.coach_players enable row level security;

create policy coach_players_participant_read on public.coach_players
  for select using (coach_id = auth.uid() or player_id = auth.uid());

-- A regular (non-service-role) client may only ever insert a *pending*
-- request naming themselves as the requester — this is what stops a
-- malicious client from inserting a pre-approved 'active' row directly.
-- Invite-link redemption needs to insert as 'active' and bypasses this via a
-- service-role client instead (see join/[token]/+page.server.ts).
create policy coach_players_participant_insert on public.coach_players
  for insert with check (
    (coach_id = auth.uid() or player_id = auth.uid())
    and requested_by = auth.uid()
    and status = 'pending'
  );

-- Update is for accepting a pending request. The check clause stops the
-- original requester from approving their own request: after the update,
-- either the row is still pending, or (if now active) the acting user must
-- NOT be the requester — only the other party can activate it.
create policy coach_players_participant_update on public.coach_players
  for update
  using (coach_id = auth.uid() or player_id = auth.uid())
  with check (
    (coach_id = auth.uid() or player_id = auth.uid())
    and (status = 'pending' or requested_by <> auth.uid())
  );

-- Delete covers both cancelling your own pending request and declining one
-- you received, plus unlinking an active relationship — any participant, any
-- status, no extra restriction needed for any of those three cases.
create policy coach_players_participant_delete on public.coach_players
  for delete using (coach_id = auth.uid() or player_id = auth.uid());

-- RLS's WITH CHECK cannot reference the pre-update row, so it cannot by
-- itself stop a participant from rewriting coach_id/player_id/requested_by
-- as part of the same UPDATE that flips status to 'active' — that would let
-- someone self-approve a relationship, or hijack an active one by pointing
-- it at a different (non-consenting) party. This trigger closes that gap by
-- rejecting any UPDATE that touches those three columns, and rejecting any
-- attempt to revert an active relationship back to pending.
create or replace function public.coach_players_guard_update()
returns trigger language plpgsql as $$
begin
  if new.coach_id <> old.coach_id or new.player_id <> old.player_id or new.requested_by <> old.requested_by then
    raise exception 'coach_players: coach_id, player_id, and requested_by cannot be changed';
  end if;
  if old.status = 'active' and new.status = 'pending' then
    raise exception 'coach_players: cannot revert an active relationship to pending';
  end if;
  return new;
end;
$$;

create trigger coach_players_guard_update
  before update on public.coach_players
  for each row execute function public.coach_players_guard_update();

-- Migrate existing single-coach data: every profile with a coach_id today
-- becomes one active row, requested_by the coach (today's model is always
-- coach-initiated, via invite link).
insert into public.coach_players (coach_id, player_id, status, requested_by, responded_at)
select coach_id, id, 'active', coach_id, created_at
from public.profiles
where coach_id is not null;

-- Directory views for browsing profiles you have no relationship with yet.
-- Deliberately NOT security_invoker: the point is to expose a narrow column
-- set that profiles' own RLS does not grant to an unconnected user. Access is
-- controlled by the GRANT below (authenticated only), not a view-level RLS
-- check, and the view only ever returns 5 columns regardless of caller.
create view public.coach_directory as
select id, first_name, last_name, display_name, avatar_id
from public.profiles
where role = 'coach';
grant select on public.coach_directory to authenticated;
revoke all on public.coach_directory from anon, public;

create view public.player_directory as
select id, first_name, last_name, display_name, avatar_id
from public.profiles
where role = 'player';
grant select on public.player_directory to authenticated;
revoke all on public.player_directory from anon, public;

-- Replace profiles_coach_read (coach reading a player's profile only) with a
-- symmetric policy covering both directions and both pending + active rows
-- (you need to see who sent a request in order to decide on it). Not
-- recursive: this queries coach_players, a different table, not profiles.
drop policy profiles_coach_read on public.profiles;
create policy profiles_relationship_read on public.profiles for select using (
  exists (
    select 1 from public.coach_players cp
    where (cp.coach_id = profiles.id and cp.player_id = auth.uid())
       or (cp.player_id = profiles.id and cp.coach_id = auth.uid())
  )
);

-- Every other coach-read policy moves from `coach_id = auth.uid()` to an
-- active coach_players relationship check.
drop policy repertoires_coach_read on public.repertoires;
create policy repertoires_coach_read on public.repertoires for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = repertoires.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy moves_coach_read on public.moves;
create policy moves_coach_read on public.moves for select using (
  exists (
    select 1 from public.repertoires r
    join public.coach_players cp on cp.player_id = r.player_id and cp.status = 'active'
    where r.id = moves.repertoire_id and cp.coach_id = auth.uid()
  )
);

drop policy reviews_coach_read on public.reviews;
create policy reviews_coach_read on public.reviews for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = reviews.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy sessions_coach_read on public.sessions;
create policy sessions_coach_read on public.sessions for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = sessions.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy player_stats_coach on public.player_stats;
create policy player_stats_coach on public.player_stats for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = player_stats.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

drop policy badges_coach_read on public.badges_earned;
create policy badges_coach_read on public.badges_earned for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = badges_earned.player_id and cp.coach_id = auth.uid() and cp.status = 'active'
  )
);

-- Tighten assigned_repertoires: today ANY coach can assign ANY repertoire to
-- ANY player (role check only). Require an active relationship instead.
drop policy "Coaches manage assignments" on public.assigned_repertoires;
create policy coach_players_manage_assignments on public.assigned_repertoires
  for all using (
    exists (
      select 1 from public.coach_players cp
      where cp.coach_id = assigned_repertoires.coach_id
        and cp.player_id = assigned_repertoires.player_id
        and cp.status = 'active'
    )
  );

-- update_weekly_leaderboard grouped players by profiles.coach_id for ranking,
-- which no longer exists. Re-point at coach_players, using each player's
-- earliest-formed active coach relationship as the reference group. Same
-- behavior as today for a single-coach player; a simplification (not a full
-- redesign) for the multi-coach case.
create or replace function public.update_weekly_leaderboard(p_player_id uuid, p_xp integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_coach_id   uuid;
begin
  select coach_id into v_coach_id
  from coach_players
  where player_id = p_player_id and status = 'active'
  order by created_at asc
  limit 1;

  insert into weekly_leaderboard(player_id, week_start, xp_earned)
  values (p_player_id, v_week_start, p_xp)
  on conflict (player_id) do update
    set xp_earned = case
      when weekly_leaderboard.week_start < v_week_start then p_xp
      else weekly_leaderboard.xp_earned + p_xp
    end,
    week_start = v_week_start;

  if v_coach_id is not null then
    with ranked as (
      select wl.player_id,
             row_number() over (order by wl.xp_earned desc) as r
      from weekly_leaderboard wl
      join coach_players cp on cp.player_id = wl.player_id and cp.status = 'active'
      where wl.week_start = v_week_start and cp.coach_id = v_coach_id
    )
    update weekly_leaderboard wl set rank = ranked.r
    from ranked where ranked.player_id = wl.player_id;
  end if;
end;
$$;

-- Now safe to drop: every read/write that used it has moved to coach_players.
alter table public.profiles drop column coach_id;
