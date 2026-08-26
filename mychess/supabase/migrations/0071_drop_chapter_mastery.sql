-- mychess/supabase/migrations/0071_drop_chapter_mastery.sql
--
-- Retires the chapter-mastery-run mechanic (migration 0058), superseded by
-- the knowledge-levels ladder (bronze/silver/gold/platinum, derived from
-- enumerateVariations()'s playerMoveCount + variation_solved — see
-- src/lib/mastery/chapterLevels.ts). Nothing in src/ reads or writes this
-- table any more after this feature's Tasks 4 and 6 land (masteryRun.ts,
-- server/mastery.ts, the mastery-run API route, and repertoire-progress.ts's
-- #105 chapter_mastery read are all gone/rewritten). No live users yet, so
-- this is a clean drop with no data migration, matching the precedent set by
-- 0045_remove_leveling_add_solved.sql and 0047_drop_move_progress.sql.

drop table if exists public.chapter_mastery;
