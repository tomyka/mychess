-- mychess/supabase/migrations/0027_remove_xp.sql
-- Final step of full XP-system removal: drops XP-related functions, tables, and columns
-- across profiles/sessions/review_events/quests/player_stats/badges, and removes the 3
-- now-retired level_3/5/10 badges (see WARNING below).
-- Drop XP-dependent functions first (no live callers remain once
-- Practice/Drill/Time Trial/quests stop calling them; submit_session_result
-- and sync_player_stats were already dead — only ever defined, never called
-- from application code).
drop function if exists public.update_xp_and_level(uuid, integer);
drop function if exists public.update_weekly_leaderboard(uuid, integer);
drop function if exists public.submit_session_result(uuid, jsonb);
drop function if exists public.sync_player_stats(uuid);

drop table if exists public.weekly_leaderboard;

alter table public.profiles
  drop column if exists xp,
  drop column if exists level,
  drop column if exists weekly_xp_goal;

alter table public.sessions drop column if exists xp_earned;
alter table public.review_events drop column if exists xp_delta;
alter table public.quests drop column if exists xp_reward;
alter table public.player_stats drop column if exists total_xp;

-- Task 16 retired the level_3/level_5/level_10 badge RULES entirely (no
-- replacement) — these rows would otherwise linger as permanently-locked,
-- unearnable tiles in the Trophy Room forever.
--
-- WARNING: this permanently deletes real players' earned-achievement
-- history for these 3 badges, not just an unlockable rule — if you want a
-- record of who earned them before running this, first run:
--   select player_id, badge_id, earned_at from public.badges_earned
--   where badge_id in ('level_3', 'level_5', 'level_10');
delete from public.badges_earned where badge_id in ('level_3', 'level_5', 'level_10');
delete from public.badges where id in ('level_3', 'level_5', 'level_10');
alter table public.badges drop column if exists xp_reward;
