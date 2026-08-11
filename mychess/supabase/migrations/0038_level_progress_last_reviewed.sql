-- Tracks when a player last ran a maintenance review session on an
-- already-mastered repertoire — retesting knowledge shouldn't stop once a
-- repertoire is fully learned, since memory fades over time regardless of
-- level. NULL means "never reviewed since mastering", treated as the most
-- overdue state (see reviewFreshness in src/lib/mastery/levelProgress.ts).
-- Deliberately separate from level_progress.updated_at (which tracks
-- level/queue mutations, not review activity) rather than overloading it.
alter table public.level_progress
  add column last_reviewed_at timestamptz;
