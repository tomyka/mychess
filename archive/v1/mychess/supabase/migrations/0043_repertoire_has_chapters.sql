-- mychess/supabase/migrations/0043_repertoire_has_chapters.sql
-- Caches whether a repertoire has ANY PGN-chapter-tagged variation (see
-- moves.chapter_name, migration 0042) — lets the Practice picker decide
-- whether to show chapter-selection UI at all without fetching every move
-- up front. Nullable (not a boolean default) so it follows the same
-- self-healing backfill pattern as total_variations/total_levels/
-- level1_task_count: null means "not yet computed", backfilled once on next
-- load (see loadRepertoireProgressSummaries), then cached forever since
-- moves are immutable after import.
alter table public.repertoires add column has_chapters boolean;
