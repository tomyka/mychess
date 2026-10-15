-- Replaces import-time move-depth truncation (max_variation_moves, #41) with
-- a practice-time depth ceiling the player can grow over time instead of
-- needing to re-upload the PGN as they improve. The full repertoire is
-- always imported now; practice_depth_levels just limits how deep the level
-- system currently goes into it (min(natural cap, this value)) — increasing
-- it later reveals content that was there all along, at zero extra cost.
--
-- Default of 6 matches the starting point requested for this feature.
alter table public.repertoires
  add column practice_depth_levels integer not null default 6
    check (practice_depth_levels > 0);

alter table public.repertoires
  drop column max_variation_moves;
