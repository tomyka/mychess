import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runFideImport } from '$lib/fide/import-job';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';
import { requireCronAuth } from '$lib/server/cron-auth';

// NOTE: This download+parse job is heavy (~47 MB download, ~200 MB decompressed,
// thousands of upserts) and may exceed serverless time/memory limits. Prefer the
// GitHub Action runner (npm run fide:import). This endpoint is for manual/on-demand use.
export const POST: RequestHandler = async ({ request }) => {
  const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  requireCronAuth(request, CRON_SECRET);

  try {
    const result = await runFideImport(
      requireEnv(PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL'),
      requireEnv(SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
    );
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(500, `FIDE import failed: ${msg}`);
  }
};
