import { countRateLimited, recordResults } from '@mychess/db';
import {
  accountStage,
  resultBatchSchema,
  TRAINING_RATE_LIMIT,
  trainingRateKey,
} from '@mychess/domain';
import { getDb } from '../../../../server/db';
import { getAccount } from '../../../../server/session';

// A player's own training: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

/** A batch that can never be recorded: the browser drops it (S6 lead decision 3). */
const BAD_BATCH = 'training.badBatch';

/**
 * Whether the body is declared JSON. A cross-site form can post only
 * form encodings or text/plain without a preflight, so refusing anything
 * else is a cheap guard against a forged post.
 */
const isJson = (request: Request): boolean =>
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
  'application/json';

/**
 * POST a batch of training results (S6 decisions 2-6); the answer names
 * each result's fate by its id. Recorded for the session account only: a
 * player id in the body is stripped by the schema. The request is counted
 * before its body is read, so a flood of bad bodies is limited too; a
 * body not declared JSON is refused unread (415).
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getAccount();
  if (account === null)
    return Response.json(null, { status: 401, headers: NO_STORE });
  if (accountStage(account) !== 'onboarded')
    return Response.json(null, { status: 403, headers: NO_STORE });
  const limited = await countRateLimited(
    getDb(),
    trainingRateKey(account.id),
    TRAINING_RATE_LIMIT,
    new Date(),
  );
  if (!limited.ok)
    return Response.json(
      { reason: limited.refusal.reason },
      { status: 429, headers: NO_STORE },
    );
  if (!isJson(request))
    return Response.json(
      { reason: BAD_BATCH },
      { status: 415, headers: NO_STORE },
    );
  const body: unknown = await request.json().catch(() => null);
  const batch = resultBatchSchema.safeParse(body);
  if (!batch.success)
    return Response.json(
      { reason: BAD_BATCH },
      { status: 400, headers: NO_STORE },
    );
  const answers = await recordResults(
    getDb(),
    account.id,
    batch.data,
    new Date(),
  );
  return Response.json({ answers }, { headers: NO_STORE });
}
