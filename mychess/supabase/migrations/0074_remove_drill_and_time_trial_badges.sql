-- mychess/supabase/migrations/0074_remove_drill_and_time_trial_badges.sql
--
-- Removes the eight Drill and Time Trial badges from the `badges` catalog.
-- Same problem and same remedy as `0053_remove_unearnable_badge.sql`:
-- `(player)/badges/+page.server.ts` renders the whole `badges` table, so every
-- player has been shown badges that nobody can earn.
--
-- Two separate reasons they are unobtainable, both now permanent:
--
--   first_drill, drill_chain_5, drill_chain_10, drill_chain_20, drill_ace
--     Seeded by 0006_badges.sql. Their rules were deleted from
--     `src/lib/badges/recalc.ts` by `be276f7` ("remove Master mode
--     entirely"); the catalog rows were left behind. Nothing has been able to
--     grant these for as long as that commit is old.
--
--   first_time_trial, speed_demon, speed_legend
--     Kept their rules until now, but every rule tested `ttScore`, which
--     `grantNewBadges` hardcoded to 0 and only `/api/time-trial` ever
--     overrode. That endpoint and its page were unreachable — no nav entry,
--     no link, no `goto` — and both are now removed, along with these three
--     rules.
--
-- The delete is guarded on `badges_earned` rather than trusting the reasoning
-- above. `badges_earned.badge_id` references `badges(id)` with no ON DELETE
-- clause (0001_core_tables.sql:112), so NO ACTION applies: an unguarded delete
-- would not quietly cascade someone's badge away, it would fail the whole
-- migration on a foreign-key violation. The guard turns that into "leave that
-- one row alone and remove the rest". Counts were checked as 0 for the three
-- Time Trial ids before writing this; the guard covers the five Drill ids too.
-- Scoped by id and idempotent, so re-running is a no-op.
--
-- If Drill or Time Trial is ever rebuilt, re-add the catalog rows AND their
-- recalc rules together — that pairing is exactly what went missing here.
delete from public.badges b
where b.id in (
  'first_drill',
  'drill_chain_5',
  'drill_chain_10',
  'drill_chain_20',
  'drill_ace',
  'first_time_trial',
  'speed_demon',
  'speed_legend'
)
and not exists (
  select 1 from public.badges_earned e where e.badge_id = b.id
);
