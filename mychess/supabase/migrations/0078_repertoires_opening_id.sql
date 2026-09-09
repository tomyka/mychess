-- mychess/supabase/migrations/0078_repertoires_opening_id.sql
--
-- #201 (epic #119): which curated opening a repertoire prepares.
--
-- Holds ONLY a coach's explicit correction. The usual answer is derived at read
-- time from (eco_code, color) via src/lib/openings/taxonomy.ts — see
-- resolveOpening's comment for why deriving beats storing while the taxonomy is
-- still being authored. So this column is null on almost every row, by design.
--
-- Deliberately no foreign key: the taxonomy is a TypeScript module, not a
-- table, because every migration in this project is applied by hand and the
-- list will churn. Integrity is a test instead — taxonomy.test.ts keeps ids
-- unique, and resolveOpening returns null for an id the list no longer has.
-- Same trade already made by variation_chapter_practice_exclusions.chapter_name.

alter table public.repertoires
  add column opening_id text;
