import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runScrapeJob } from '$lib/tournaments/scrape-job';
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!CRON_SECRET || token !== CRON_SECRET) {
    throw error(401, 'Unauthorized');
  }

  try {
    const result = await runScrapeJob(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(500, `Scrape failed: ${msg}`);
  }
};
