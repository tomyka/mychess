-- mychess/supabase/migrations/0047_drop_move_progress.sql
-- move_progress backed Master mode's per-move-edge progress tracking (see
-- 0025_move_progress.sql). Master mode was removed entirely and nothing in
-- the current codebase reads or writes this table — dropped outright,
-- matching 0045_remove_leveling_add_solved.sql's own precedent for
-- removing a superseded feature's table rather than leaving it inert.
drop table if exists public.move_progress;
