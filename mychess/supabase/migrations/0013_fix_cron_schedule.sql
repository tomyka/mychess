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
