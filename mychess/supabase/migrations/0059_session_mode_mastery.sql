-- Story #103 of epic #95: session-mode instrumentation.
--
-- Adds 'mastery' to the allowed session modes. Deliberately a NEW value rather
-- than reusing the existing 'master': that one already means the old
-- Drill-renamed-to-Master mode (migration 0026), and folding two different
-- activities into one value would make the mode column unable to answer the
-- question this story exists to answer.
--
-- Existing values are kept, not pruned — re-adding a check constraint validates
-- every existing row, and historical rows carry 'drill'/'time_trial'/'master'.

alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('learn','practice','mastery','drill','time_trial','master'));
