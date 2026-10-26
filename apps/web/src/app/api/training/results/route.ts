import { countRateLimited, countWeighted, recordResults } from '@mychess/db';
import {
  accountStage,
  batchResponse,
  resultBatchSchema,
  TRAINING_RATE_LIMIT,
  TRAINING_RESULTS_RATE_LIMIT,
  trainingRateKey,
  trainingResultsKey,
  unreadRefusal,
  type BatchOutcome,
} from '@mychess/domain';
import { getDb } from '../../../../server/db';
import { getAccount } from '../../../../server/session';

// A player's own training: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

/** The endpoint's answer to `outcome`, never kept by a cache. */
function respond(outcome: BatchOutcome): Response {
  const { status, body } = batchResponse(outcome);
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * POST a batch of training results (S6 decisions 2-6); the answer names
 * each result's fate by its id. Recorded for the session account only: a
 * player id in the body is stripped by the schema. The request is counted
 * as a batch before its body is read, so a flood of bad bodies is limited
 * too; a body the domain's unreadRefusal rejects (not JSON, too large) is
 * refused unread. A parsed batch is counted again by its results, so
 * large batches carry no more results a minute than small ones could.
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getAccount();
  if (account === null) return respond({ kind: 'unauthenticated' });
  if (accountStage(account) !== 'onboarded')
    return respond({ kind: 'notOnboarded' });
  const now = new Date();
  const limited = await countRateLimited(
    getDb(),
    trainingRateKey(account.id),
    TRAINING_RATE_LIMIT,
    now,
  );
  if (!limited.ok)
    return respond({ kind: 'rateLimited', reason: limited.refusal.reason });
  const unread = unreadRefusal({
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
  });
  if (unread !== undefined) return respond(unread);
  const body: unknown = await request.json().catch(() => null);
  const batch = resultBatchSchema.safeParse(body);
  if (!batch.success) return respond({ kind: 'malformed' });
  const results = await countWeighted(getDb(), {
    key: trainingResultsKey(account.id),
    rule: TRAINING_RESULTS_RATE_LIMIT,
    now,
    weight: batch.data.length,
  });
  if (!results.ok)
    return respond({ kind: 'rateLimited', reason: results.refusal.reason });
  const answers = await recordResults(getDb(), account.id, batch.data, now);
  return respond({ kind: 'recorded', answers });
}
