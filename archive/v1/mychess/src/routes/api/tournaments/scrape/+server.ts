import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runScrapeJob } from '$lib/tournaments/scrape-job';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';
import { requireCronAuth } from '$lib/server/cron-auth';

export const POST: RequestHandler = async ({ request }) => {
  const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  requireCronAuth(request, CRON_SECRET);

  try {
    const result = await runScrapeJob(
      requireEnv(PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL'),
      requireEnv(SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
    );
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(500, `Scrape failed: ${msg}`);
  }
};
