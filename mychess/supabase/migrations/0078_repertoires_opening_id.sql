-- mychess/supabase/migrations/0078_repertoires_opening_id.sql
--
-- #201 (epic #119): which curated opening a repertoire prepares.
--
-- Holds ONLY a coach's explicit correction. The usual answer is derived at read
-- time from (eco_code, color) against the list in src/lib/openings/taxonomy.ts
-- — see `resolveOpening` in src/lib/openings/resolve.ts for why deriving beats
-- storing while the taxonomy is still being authored. So this column is null on
-- almost every row, by design.
--
-- Deliberately no foreign key: the taxonomy is a TypeScript module, not a
-- table, because every migration in this project is applied by hand and the
-- list will churn. Integrity is a test instead — taxonomy.test.ts keeps ids
-- unique, and resolveOpening returns null for an id the list no longer has.
-- Same trade already made by variation_chapter_practice_exclusions.chapter_name.
--
-- And no CHECK constraint either, for the same reason — worth saying because
-- `repertoires.color` (0001) does constrain its enum-like text that way, so the
-- omission here would otherwise read as an oversight. `color`'s two values are
-- settled; this column's slug list is expected to churn, and every revision
-- would cost another hand-applied migration. `eco_code` (0022) is the closer
-- precedent: open-ended classification, plain text, no constraint.

alter table public.repertoires
  add column opening_id text;
