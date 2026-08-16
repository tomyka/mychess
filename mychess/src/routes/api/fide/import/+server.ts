import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runFideImport } from '$lib/fide/import-job';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';
import { requireCronAuth } from '$lib/server/cron-auth';

// NOTE: This is now the primary path for the monthly FIDE import (triggered
// by .github/workflows/fide-import.yml via a plain authenticated POST), not
// just a manual/on-demand fallback -- ratings.fide.com appears to hard-block
// GitHub Actions' own runner IP ranges (confirmed Aug 2026: consistent
// TCP-connect timeouts from the runner, fine from any ordinary connection),
// so the actual download has to happen from Vercel's network instead. This
// download+parse job is heavy (~47 MB download, ~200 MB decompressed,
// thousands of upserts) -- if it starts exceeding Vercel's function time/
// memory limits, that's the thing to revisit, not which runner triggers it.
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
