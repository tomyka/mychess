-- Phase B: new tables, columns, and RPCs

-- Expand sessions.mode to include drill and time_trial
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('learn','practice','drill','time_trial'));

-- Add missing player_stats columns used by home page
alter table public.player_stats
  add column if not exists total_xp         integer not null default 0,
  add column if not exists streak_days      integer not null default 0,
  add column if not exists new_cards_today  integer not null default 0,
  add column if not exists last_stats_date  date;

-- Add weekly XP goal to profiles
alter table public.profiles
  add column if not exists weekly_xp_goal integer not null default 200;

-- Add cosmetics columns to profiles
alter table public.profiles
  add column if not exists board_theme text not null default 'classic',
  add column if not exists avatar_id   text not null default 'knight';

-- Add read_at to coach_notes
alter table public.coach_notes
  add column if not exists read_at timestamptz;

-- Quests table
create table if not exists public.quests (
  id           uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profiles(id) on delete cascade,
  date         date not null,
  template_id  text not null,
  description  text not null,
  target       integer not null,
  progress     integer not null default 0,
  xp_reward    integer not null default 50,
  completed_at timestamptz,
  unique(player_id, date, template_id)
);
alter table public.quests enable row level security;
create policy "Players manage own quests" on public.quests
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());

-- Weekly leaderboard table
create table if not exists public.weekly_leaderboard (
  player_id     uuid primary key references public.profiles(id) on delete cascade,
  week_start date not null,
  xp_earned  integer not null default 0,
  rank       integer
);
alter table public.weekly_leaderboard enable row level security;
create policy "Anyone can view leaderboard" on public.weekly_leaderboard
  for select using (true);
create policy "Service role manages leaderboard" on public.weekly_leaderboard
  for all using (auth.role() = 'service_role');

-- Assigned repertoires table
create table if not exists public.assigned_repertoires (
  id            uuid primary key default gen_random_uuid(),
  coach_id      uuid not null references public.profiles(id),
  player_id        uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  note          text,
  due_date      date,
  assigned_at   timestamptz not null default now(),
  unique(player_id, repertoire_id)
);
alter table public.assigned_repertoires enable row level security;
create policy "Players see own assignments" on public.assigned_repertoires
  for select using (player_id = auth.uid());
create policy "Coaches manage assignments" on public.assigned_repertoires
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coach')
  );

-- RPC: sync player_stats.total_xp and streak_days from profiles after each session
create or replace function public.sync_player_stats(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_xp     integer;
  v_streak integer;
begin
  select xp, streak_days into v_xp, v_streak from profiles where id = p_player_id;
  insert into player_stats(player_id, total_xp, streak_days, updated_at)
  values (p_player_id, v_xp, v_streak, now())
  on conflict (player_id) do update
    set total_xp    = excluded.total_xp,
        streak_days = excluded.streak_days,
        updated_at  = now();
end;
$$;

-- RPC: increment new_cards_today (auto-reset when date changes)
create or replace function public.increment_new_cards(p_player_id uuid, p_count integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into player_stats(player_id, new_cards_today, last_stats_date)
  values (p_player_id, p_count, current_date)
  on conflict (player_id) do update
    set new_cards_today = case
      when player_stats.last_stats_date < current_date then p_count
      else player_stats.new_cards_today + p_count
    end,
    last_stats_date = current_date;
end;
$$;

-- RPC: update weekly leaderboard for a player and recompute ranks within coach group
create or replace function public.update_weekly_leaderboard(p_player_id uuid, p_xp integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_coach_id   uuid;
begin
  select coach_id into v_coach_id from profiles where id = p_player_id;

  insert into weekly_leaderboard(player_id, week_start, xp_earned)
  values (p_player_id, v_week_start, p_xp)
  on conflict (player_id) do update
    set xp_earned = case
      when weekly_leaderboard.week_start < v_week_start then p_xp
      else weekly_leaderboard.xp_earned + p_xp
    end,
    week_start = v_week_start;

  -- Recompute ranks for all players under the same coach
  if v_coach_id is not null then
    with ranked as (
      select wl.player_id,
             row_number() over (order by wl.xp_earned desc) as r
      from weekly_leaderboard wl
      join profiles p on p.id = wl.player_id
      where wl.week_start = v_week_start and p.coach_id = v_coach_id
    )
    update weekly_leaderboard wl set rank = ranked.r
    from ranked where ranked.player_id = wl.player_id;
  end if;
end;
$$;
