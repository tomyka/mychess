import { preindexBroadcastMonths } from '../../../../server/broadcast-preindex';
import { cronRefusal } from '../../../../server/cron-request';

// The nightly pre-index of the 12 newest broadcast months (#354, R-195):
// the VM's timer calls it with `Authorization: Bearer <CRON_SECRET>`. It
// answers 202 once the months are queued, never waiting for the runner;
// the body holds counts only. Machine-readable answers, not user text.
const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  const refused = cronRefusal(request);
  if (refused !== undefined) return refused;
  const counts = await preindexBroadcastMonths(new Date());
  return Response.json(counts, { status: 202, headers: NO_STORE });
}
