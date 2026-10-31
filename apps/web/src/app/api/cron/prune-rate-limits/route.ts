import { createDb, databaseEnvSchema, pruneRateLimits } from '@mychess/db';
import { z } from 'zod';
import { sameSecret } from '../../../../server/same-secret';

// The scheduled prune of the rate-limit tables (#262, #234): Vercel Cron
// calls it daily with `Authorization: Bearer <CRON_SECRET>`. Absent (404)
// where CRON_SECRET is not set. Machine-readable answers, not user text.
const NO_STORE = { 'cache-control': 'no-store' };
const cronEnvSchema = z.object({ CRON_SECRET: z.string().min(32).optional() });

const status = (code: number) => new Response(null, { status: code });

export async function GET(request: Request): Promise<Response> {
  const { CRON_SECRET } = cronEnvSchema.parse(process.env);
  if (CRON_SECRET === undefined) return status(404);
  const given = request.headers.get('authorization') ?? '';
  if (!sameSecret(given, `Bearer ${CRON_SECRET}`)) return status(401);
  const { DATABASE_URL } = databaseEnvSchema.parse(process.env);
  const { db, close } = createDb(DATABASE_URL);
  try {
    const pruned = await pruneRateLimits(db, new Date());
    return Response.json({ pruned }, { headers: NO_STORE });
  } finally {
    await close();
  }
}
