import { createDb, databaseEnvSchema, pruneRateLimits } from '@mychess/db';
import { cronRefusal } from '../../../../server/cron-request';

// The scheduled prune of the rate-limit tables (#262, #234): the VM's
// mychess-rate-limit-prune.timer calls it daily with
// `Authorization: Bearer <CRON_SECRET>`. Absent (404)
// where CRON_SECRET is not set. Machine-readable answers, not user text.
const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  const refused = cronRefusal(request);
  if (refused !== undefined) return refused;
  const { DATABASE_URL } = databaseEnvSchema.parse(process.env);
  const { db, close } = createDb(DATABASE_URL);
  try {
    const pruned = await pruneRateLimits(db, new Date());
    return Response.json({ pruned }, { headers: NO_STORE });
  } finally {
    await close();
  }
}
