-- OPTIONAL: schedule the FIDE import monthly via Supabase Cron (pg_cron), for teams
-- preferring Supabase-side scheduling over the GitHub Action.
--
-- ⚠️  DO NOT AUTO-APPLY: replace <PROJECT_REF> with your Supabase project ref and
--     <CRON_SECRET> with the value of your CRON_SECRET env var before running.
--
-- Requires the pg_net extension. Idempotent: unschedule skips if the job is absent.

select cron.unschedule('fide-import') from cron.job where jobname = 'fide-import';

select cron.schedule(
  'fide-import',
  '0 3 1 * *',
  $$
  select net.http_post(
    url    => 'https://<PROJECT_REF>.vercel.app/api/fide/import',
    headers => '{"Content-Type": "application/json", "Authorization": "Bearer <CRON_SECRET>"}'::jsonb
  );
  $$
);
