-- mychess/supabase/migrations/0076_fix_cron_schedule.sql
--
-- NOTE ON NUMBERING: authored and APPLIED TO PRODUCTION as `0013_...`, then
-- renumbered to 0076 because `0013_fide_players.sql` already held that number —
-- two files at one version, from parallel branches. `supabase db push` keys on
-- the version parsed from the filename, so the collision left one of the pair
-- permanently unmatched against the migration history table and blocked every
-- push (GitHub issue #156). 0074/0075 were already claimed by unmerged
-- branches, hence 0076. Same situation, and same remedy, as
-- `0063_repertoire_update.sql`'s own note.
--
-- ⚠️  MANUAL ONLY — never let `db push` run this. It contains literal
-- YOUR_APP_URL / YOUR_CRON_SECRET placeholders, and its `cron.unschedule` is
-- unguarded (unlike 0014's), so an automated replay would either error or
-- install a cron job pointing at a nonexistent host. It is recorded as applied
-- in `supabase_migrations.schema_migrations` precisely so push skips it.
--
-- Fix cron schedule: call the SvelteKit /api/tournaments/scrape route (not a Supabase Edge Function).
--
-- The previous schedule (0009_cron_schedule.sql) had two bugs:
--   1. Wrong URL — pointed to a non-existent Edge Function instead of the SvelteKit API route.
--   2. Missing Authorization header — the endpoint requires Bearer <CRON_SECRET>.
--
-- ⚠️  Requires pg_cron and pg_net extensions (enable in Dashboard → Database → Extensions).
-- ⚠️  Substitute YOUR_APP_URL and YOUR_CRON_SECRET before running this in the SQL Editor.
--     Example: https://mychess.vercel.app  and  the value you set for CRON_SECRET in Vercel.

select cron.unschedule('tournaments-scrape');

select cron.schedule(
  'tournaments-scrape',
  '0 */6 * * *',
  $cron$
  select net.http_post(
    url     => 'https://YOUR_APP_URL/api/tournaments/scrape',
    headers => '{"Content-Type":"application/json","Authorization":"Bearer YOUR_CRON_SECRET"}'::jsonb
  );
  $cron$
);
