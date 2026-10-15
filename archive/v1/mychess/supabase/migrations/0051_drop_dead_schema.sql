-- mychess/supabase/migrations/0051_drop_dead_schema.sql
--
-- Housekeeping: drops schema no application code references anymore, found
-- by auditing every column/table/function each migration created against a
-- grep of `src/`. DESTRUCTIVE AND IRREVERSIBLE — unlike 0050 (a pure
-- security fix), nothing here is urgent, and it should only be applied once
-- someone is comfortable losing this data permanently.
--
-- Per this project's CLAUDE.md, migration files are known to have drifted
-- from the live schema more than once, so every statement is guarded with
-- `if exists`: the goal is that this migration applies cleanly regardless of
-- whether a given object actually survives in production.
--
-- Verified before writing: none of the tables dropped below appear in any
-- `from('...')` call anywhere in `src/`, and the cosmetics feature writes
-- `profiles.board_theme` / `profiles.avatar_id` (see
-- `api/cosmetics/equip/+server.ts`), never the catalog tables.
--
-- `equipped_cosmetics` itself is deliberately KEPT, even though all three of
-- its cosmetic columns are dropped below, leaving only its `player_id` key.
-- It is still written — as a bare `upsert({ player_id })` on profile creation
-- (`server/guest.ts:15`, `server/onboarding.ts:30`) — so dropping the table
-- here would break signup for anyone whose browser hit the old code between
-- this migration running and the next deploy landing. Retiring it properly
-- means first shipping code that stops writing it, THEN dropping it; that
-- sequencing is deliberately left as a separate follow-up rather than
-- smuggled into a housekeeping migration.

-- Dead columns on `equipped_cosmetics`. Dropped BEFORE the catalog tables
-- below so that those drops don't need `cascade` (these three columns carry
-- the ONLY foreign keys into those tables anywhere in the schema — verified
-- against 0001_core_tables.sql:129-134, which is where all three are
-- defined). Dropping a column drops its FK constraint with it.
--
-- The live cosmetics feature writes `profiles.board_theme` and
-- `profiles.avatar_id` instead (see `api/cosmetics/equip/+server.ts`) — note
-- `profiles.avatar_id` is a DIFFERENT, live column that must not be confused
-- with `equipped_cosmetics.avatar_id` dropped here.
alter table public.equipped_cosmetics drop column if exists avatar_id;
alter table public.equipped_cosmetics drop column if exists theme_id;
alter table public.equipped_cosmetics drop column if exists piece_set;

-- Dead tables: zero `from('...')` references in src/.
--
-- `variation_progress` additionally still carries the very
-- `unique(player_id, variation_key)` btree constraint whose index-row-size
-- overflow migration 0049 had to fix on the three sibling tables — dropping
-- the table resolves that unpatched instance too.
drop table if exists public.variation_progress;
drop table if exists public.review_events;
drop table if exists public.avatars;
drop table if exists public.themes;
drop table if exists public.piece_sets;

-- Superseded by `moves.chapter_names` (migration 0048, applied and verified
-- in production). The singular column was only ever set on chapter-ending
-- leaf moves; nothing in src/ reads it now.
alter table public.moves drop column if exists chapter_name;

-- Dead columns, zero references in src/.
alter table public.repertoires          drop column if exists is_draft;
alter table public.profiles             drop column if exists streak_freeze;
alter table public.profiles             drop column if exists last_active_date;
alter table public.profiles             drop column if exists daily_goal;
alter table public.profiles             drop column if exists rank_basis;
alter table public.profiles             drop column if exists fide_rating;
alter table public.player_stats         drop column if exists last_stats_date;
alter table public.assigned_repertoires drop column if exists due_date;

-- Functions left broken by earlier migrations: each reads a column or table
-- that 0019 / 0027 already dropped (`profiles.coach_id`, `profiles.xp`,
-- `weekly_leaderboard`), so any call would error. None is called from src/ —
-- only `update_streak` is, and it is deliberately kept.
drop function if exists public.update_weekly_leaderboard(uuid, integer);
drop function if exists public.sync_player_stats(uuid);
drop function if exists public.update_xp_and_level(uuid, integer);
