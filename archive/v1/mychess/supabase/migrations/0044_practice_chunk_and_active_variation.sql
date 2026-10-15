-- mychess/supabase/migrations/0044_practice_chunk_and_active_variation.sql
-- Two changes enabling sequential, one-variation-at-a-time Practice instead
-- of the breadth-first "every variation advances together" model:
--
-- 1. chunk_size: how many of the player's own moves make up one level
--    (replaces the hardcoded MOVES_PER_LEVEL=3 constant in
--    src/lib/mastery/levels.ts) — configurable per repertoire so a player
--    can shrink it for a repertoire with very long lines instead of being
--    stuck chaining large chunks of moves at once to advance.
-- 2. active_variation_key: which ONE variation level_progress.level/queue
--    currently track. Nullable — null means "not yet decided," resolved to
--    the first variation in enumerateVariations()'s own order (see
--    pickActiveVariation in src/lib/mastery/variationSequence.ts).
alter table public.repertoires
  add column chunk_size integer not null default 3
    check (chunk_size > 0);

alter table public.level_progress
  add column active_variation_key text;

-- Existing progress was computed breadth-first across every variation at
-- once — it doesn't correspond to "how far into ONE variation" under the
-- new sequential model, and reconciling it in place could show a
-- never-before-practiced variation's LATER levels as already in progress.
-- Reset to a fresh Level 1 run; loadSyncedLevelProgress picks the first
-- variation and builds it a proper queue on next load. No other users yet
-- (see CLAUDE.md) — nothing of value is lost.
update public.level_progress
  set level = 1, prev_level_mistakes = 0, queue = '[]'::jsonb, active_variation_key = null;
