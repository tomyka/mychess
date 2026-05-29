-- Schedule the tournaments-scrape Edge Function every 6 hours via Supabase Cron (pg_cron).
-- Requires the pg_net extension and your Edge Function URL.
-- Replace <PROJECT_REF> with your actual Supabase project reference.
-- This migration is idempotent: cron.unschedule skips if the job doesn't exist.

select cron.unschedule('tournaments-scrape') from cron.job where jobname = 'tournaments-scrape';

select cron.schedule(
  'tournaments-scrape',
  '0 */6 * * *',
  $$
  select net.http_post(
    url    => 'https://<PROJECT_REF>.supabase.co/functions/v1/tournaments-scrape',
    headers => '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
