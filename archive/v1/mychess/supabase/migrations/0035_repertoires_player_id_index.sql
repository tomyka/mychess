-- Postgres doesn't auto-index foreign key columns. `repertoires.player_id`
-- is filtered on every repertoires list/dashboard/practice-picker load
-- (`.eq('player_id', ...)`) — not a measured bottleneck at current data
-- volume, but a real gap worth closing before it becomes one.
create index if not exists repertoires_player_id_idx on public.repertoires (player_id);
