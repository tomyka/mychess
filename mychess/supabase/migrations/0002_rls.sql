alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.repertoires enable row level security;
alter table public.positions enable row level security;
alter table public.moves enable row level security;
alter table public.reviews enable row level security;
alter table public.sessions enable row level security;
alter table public.review_events enable row level security;
alter table public.player_stats enable row level security;
alter table public.badges_earned enable row level security;
alter table public.coach_notes enable row level security;
alter table public.equipped_cosmetics enable row level security;

-- Profiles
create policy "profiles_self_read"  on public.profiles for select using (id = auth.uid());
create policy "profiles_self_write" on public.profiles for update using (id = auth.uid());
create policy "profiles_coach_read" on public.profiles for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach')
  and coach_id = auth.uid()
);
create policy "profiles_insert_self" on public.profiles for insert with check (id = auth.uid());

-- Repertoires
create policy "repertoires_player_all"    on public.repertoires for all    using (player_id = auth.uid());
create policy "repertoires_coach_read" on public.repertoires for select using (
  exists (select 1 from public.profiles k where k.id = player_id and k.coach_id = auth.uid())
);

-- Positions (shared, all authenticated can read and insert)
create policy "positions_auth_read"   on public.positions for select using (auth.role() = 'authenticated');
create policy "positions_auth_insert" on public.positions for insert with check (auth.role() = 'authenticated');

-- Moves
create policy "moves_player_all" on public.moves for all using (
  exists (select 1 from public.repertoires r where r.id = repertoire_id and r.player_id = auth.uid())
);
create policy "moves_coach_read" on public.moves for select using (
  exists (
    select 1 from public.repertoires r
    join public.profiles k on k.id = r.player_id
    where r.id = repertoire_id and k.coach_id = auth.uid()
  )
);

-- Reviews
create policy "reviews_player_all"    on public.reviews for all    using (player_id = auth.uid());
create policy "reviews_coach_read" on public.reviews for select using (
  exists (select 1 from public.profiles k where k.id = player_id and k.coach_id = auth.uid())
);

-- Sessions
create policy "sessions_player_all"    on public.sessions for all    using (player_id = auth.uid());
create policy "sessions_coach_read" on public.sessions for select using (
  exists (select 1 from public.profiles k where k.id = player_id and k.coach_id = auth.uid())
);

-- Review events (ownership via session join)
create policy "review_events_player_all" on public.review_events for all using (
  exists (select 1 from public.sessions s where s.id = session_id and s.player_id = auth.uid())
);

-- Player stats
create policy "player_stats_self"        on public.player_stats for select using (player_id = auth.uid());
create policy "player_stats_self_insert" on public.player_stats for insert with check (player_id = auth.uid());
create policy "player_stats_coach"       on public.player_stats for select using (
  exists (select 1 from public.profiles k where k.id = player_id and k.coach_id = auth.uid())
);

-- Badges earned
create policy "badges_player_read"   on public.badges_earned for select using (player_id = auth.uid());
create policy "badges_coach_read" on public.badges_earned for select using (
  exists (select 1 from public.profiles k where k.id = player_id and k.coach_id = auth.uid())
);

-- Coach notes
create policy "coach_notes_coach_all" on public.coach_notes for all    using (coach_id = auth.uid());
create policy "coach_notes_player_read"  on public.coach_notes for select using (player_id = auth.uid());

-- Equipped cosmetics
create policy "cosmetics_player_all"    on public.equipped_cosmetics for all using (player_id = auth.uid());
create policy "cosmetics_player_insert" on public.equipped_cosmetics for insert with check (player_id = auth.uid());

-- Invites
create policy "invites_coach_all"     on public.invites for all    using (coach_id = auth.uid());
create policy "invites_read_by_token" on public.invites for select using (true);

-- Badges catalog (read-only for all authenticated)
create policy "badges_catalog_read" on public.badges for select using (auth.role() = 'authenticated');
create policy "avatars_read"        on public.avatars for select using (true);
create policy "themes_read"         on public.themes  for select using (true);
create policy "piece_sets_read"     on public.piece_sets for select using (true);
