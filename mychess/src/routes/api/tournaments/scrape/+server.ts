import { timingSafeEqual, createHmac } from 'crypto';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runScrapeJob } from '$lib/tournaments/scrape-job';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
const { PUBLIC_SUPABASE_URL } = pubEnv;

const HMAC_KEY = Buffer.from('timing-safe-compare');

// Hash both sides to fixed-length output to prevent length-based timing side-channel
function safeCompare(a: string, b: string): boolean {
  const ha = createHmac('sha256', HMAC_KEY).update(a).digest();
  const hb = createHmac('sha256', HMAC_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!CRON_SECRET || !safeCompare(token, CRON_SECRET)) {
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
