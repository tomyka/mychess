// Supabase Edge Function: tournaments-scrape
// Called every 6 hours by Supabase Cron (pg_cron) via net.http_post.
// Environment variables required:
//   APP_URL      - The deployed app URL, e.g. https://mychess.vercel.app
//   CRON_SECRET  - Shared secret matching CRON_SECRET in the SvelteKit app

const appUrl = Deno.env.get('APP_URL') ?? '';
const cronSecret = Deno.env.get('CRON_SECRET') ?? '';

Deno.serve(async (_req) => {
  if (!appUrl || !cronSecret) {
    return new Response(
      JSON.stringify({ error: 'APP_URL and CRON_SECRET must be set' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const res = await fetch(`${appUrl}/api/tournaments/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const body = await res.json().catch(() => ({}));
  return new Response(JSON.stringify({ status: res.status, ...body }), {
    status: res.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
});
