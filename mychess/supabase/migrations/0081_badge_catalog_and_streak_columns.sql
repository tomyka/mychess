-- 0081_badge_catalog_and_streak_columns.sql
--
-- Two live-schema gaps found while verifying badge grants end to end against
-- production (GitHub issue #224). Both were invisible until #224 gave the grant
-- path real logging; both are schema, so neither could be fixed in application
-- code.

-- 1. The four epic-#95 badges exist in `RULES` (src/lib/badges/recalc.ts) but
--    never made it into the catalog table, so `badges_earned.badge_id`'s foreign
--    key rejects every grant of them:
--
--      grantNewBadges: failed to insert 2 badge row(s) for player fa28539b-…:
--      insert or update on table "badges_earned" violates foreign key
--      constraint "badges_earned_badge_id_fkey"
--
--    Observed with a QA player who had genuinely finished a repertoire (3/3
--    variations solved, 3/3 chapters completed). `first_repertoire_learned` was
--    correctly computed as eligible and could not be written.
--
--    These four are also the REVOCABLE ones, so the rows have to exist for the
--    delete path to be meaningful too.
insert into public.badges (id, name, description, icon_url, xp_reward) values
  ('first_repertoire_learned',  'Repertoire Learned',  'Learn every variation in a repertoire',        '/badges/first_repertoire_learned.svg',  100),
  ('repertoires_learned_5',     'Five Times Learned',  'Learn every variation in 5 repertoires',       '/badges/repertoires_learned_5.svg',     250),
  ('first_repertoire_mastered', 'Repertoire Mastered', 'Master every chapter in a repertoire',         '/badges/first_repertoire_mastered.svg', 200),
  ('repertoires_mastered_5',    'Five Times Mastered', 'Master every chapter in 5 repertoires',        '/badges/repertoires_mastered_5.svg',    500)
on conflict (id) do nothing;

-- 2. `update_streak` (migration 0003, deliberately kept by 0051) reads and
--    writes `profiles.last_active_date` and `profiles.streak_freeze`, and
--    NEITHER column exists in the live schema:
--
--      recordAttemptStats: update_streak failed for fa28539b-…:
--      column "last_active_date" does not exist
--
--    The function has had no caller since 0027 dropped `submit_session_result`,
--    so the drift sat undetected — nothing called it, so nothing failed. #224
--    gave it a caller again (every completed Learn attempt), which is what
--    surfaced this. Until these columns exist, `profiles.streak_days` stays 0
--    for every player and `first_streak_3` / `streak_7` / `streak_30` /
--    `streak_100` cannot fire.
--
--    Added rather than rewriting the function to drop the freeze logic: the
--    freeze is what `update_streak`'s middle branch is for, and removing it
--    would quietly change streak behaviour as a side effect of a schema fix.
alter table public.profiles
  add column if not exists last_active_date date,
  add column if not exists streak_freeze    integer not null default 0;
