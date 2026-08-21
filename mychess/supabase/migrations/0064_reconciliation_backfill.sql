-- mychess/supabase/migrations/0064_reconciliation_backfill.sql
-- Stamps every player who already holds progress as "caught up" with the
-- repertoire's CURRENT shape, so lazy reconciliation only ever fires in
-- response to a real coach change.
--
-- Without this, the re-upload feature (issue #118) mutates every existing
-- student's progress the first time they load a page after deploy, and does it
-- for repertoires nobody has touched:
--
--   * `repertoire_reconciliation` starts empty, so `reconciled_at` reads as
--     "never" for every (player, repertoire) pair.
--   * Migration 0055 gave every repertoire `moves_updated_at default now()`.
--   * `needsReconciliation` is therefore TRUE everywhere on first load.
--
-- For an untouched repertoire that produces no carries — every progress key is
-- still live — but SEEDING still runs. `buildCarryForwardPlan` seeds every live
-- line the student has no row for that shares a mastered prefix with one they
-- do, so each student gains `variation_teaching_progress` rows for siblings
-- they have never played, at inherited depth. That is the intended behaviour
-- when a coach ADDS a line; applying it retroactively to the entire existing
-- dataset is a different thing that nobody asked for, and it is not reversible
-- afterwards — a seeded row is indistinguishable from one the student earned.
--
-- The stamp copies each repertoire's own `moves_updated_at` rather than
-- `now()`, matching how the application stamps it: the freshness test is
-- `reconciled_at >= moves_updated_at`, so copying the exact value being
-- compared satisfies it without either side agreeing on what time it is. Using
-- now() would also work today but would silently mean "caught up with a shape
-- that may have changed a millisecond ago".
--
-- Only pairs that actually hold progress are stamped. A player with no
-- teaching rows has nothing to seed FROM (inheritance is computed from their
-- own mastered depths) and nothing to carry, so reconciliation is already a
-- no-op for them and an absent row correctly reads as "reconcile once, find
-- nothing to do".
--
-- Idempotent: `on conflict do nothing` leaves any row the application has
-- already written alone. Re-running cannot move a stamp backwards.
insert into public.repertoire_reconciliation (player_id, repertoire_id, reconciled_at)
select p.player_id, p.repertoire_id, r.moves_updated_at
from (
  select player_id, repertoire_id from public.variation_teaching_progress
  union
  select player_id, repertoire_id from public.variation_solved
  union
  select player_id, repertoire_id from public.variation_practice_exclusions
  union
  select player_id, repertoire_id from public.practice_active_variation
) p
join public.repertoires r on r.id = p.repertoire_id
on conflict (player_id, repertoire_id) do nothing;
