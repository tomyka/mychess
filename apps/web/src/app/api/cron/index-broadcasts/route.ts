import { cronRefusal } from '../../../../server/cron-request';
import { fideServices } from '../../../../server/fide-services';

// The nightly pre-index of the 12 newest broadcast months (#354, R-195)
// and the community broadcasts' night (#349, spec decision 3):
// the VM's timer calls it with `Authorization: Bearer <CRON_SECRET>`. It
// answers 202 once the months are queued, never waiting for the runner or
// the community night; the body holds counts and the community night's
// state only. Machine-readable answers, not user text.
const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  const refused = cronRefusal(request);
  if (refused !== undefined) return refused;
  const counts = await fideServices().preindex(new Date());
  return Response.json(counts, { status: 202, headers: NO_STORE });
}
