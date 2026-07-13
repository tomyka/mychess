-- Master mode (renamed from Drill) writes sessions.mode = 'master'; widen
-- the check constraint to allow it. 'drill' and 'time_trial' are kept in
-- the allowed set (not dropped) since existing historical session rows
-- already carry those values, and re-adding a constraint validates every
-- existing row — matches this codebase's non-destructive migration
-- convention (see CLAUDE.md).
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('learn','practice','drill','time_trial','master'));
