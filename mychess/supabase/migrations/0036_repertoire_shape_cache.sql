-- Denormalized, write-once-at-import cache of a repertoire's "shape" — the
-- part of its progress summary that depends only on its move content, never
-- on a player's level_progress. Moves are only ever written once at import
-- and never edited afterward, so this never goes stale for a given
-- repertoire (only deletion removes the row entirely). Lets
-- loadRepertoireProgressSummaries (the Dashboard + Practice picker) skip
-- fetching every move row and re-walking the variation tree on every load.
--
-- NULL for repertoires imported before this migration — those get computed
-- and backfilled lazily on first load afterward (see
-- repertoire-progress.ts), not backfilled here, since replicating the exact
-- JS tree-walk semantics in SQL isn't worth it for a handful of rows.
alter table public.repertoires
  add column total_variations integer,
  add column total_levels integer,
  add column level1_task_count integer;
