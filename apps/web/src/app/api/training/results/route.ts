import { countRateLimited, countWeighted, recordResults } from '@mychess/db';
import {
  accountStage,
  resultBatchSchema,
  TRAINING_RATE_LIMIT,
  TRAINING_RESULTS_RATE_LIMIT,
  TRAINING_REFUSALS,
  trainingRateKey,
  trainingResultsKey,
} from '@mychess/domain';
import { getDb } from '../../../../server/db';
import { getAccount } from '../../../../server/session';

// A player's own training: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

/** A batch that can never be recorded: the browser drops it (S6 lead decision 3). */
const BAD_BATCH = TRAINING_REFUSALS.badBatch;

/**
 * The largest body a batch is read from: the largest batch is far smaller.
 * A body with no declared length is left to the platform's own cap.
 */
const MAX_BODY_BYTES = 256 * 1024;

/** An answer with no body to cache: a status and, maybe, a reason. */
const refuse = (status: number, reason?: string): Response =>
  Response.json(reason === undefined ? null : { reason }, {
    status,
    headers: NO_STORE,
  });

/**
 * Whether the body is declared JSON. A cross-site form can post only
 * form encodings or text/plain without a preflight, so refusing anything
 * else is a cheap guard against a forged post.
 */
const isJson = (request: Request): boolean =>
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
  'application/json';

/** Whether the body is declared longer than any batch could be. */
const isTooLarge = (request: Request): boolean =>
  Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES;

/**
 * Why the request is refused before its body is read, or undefined: a body
 * not declared JSON (415) or declared too large (413).
 */
function refusedUnread(request: Request): Response | undefined {
  if (!isJson(request)) return refuse(415, BAD_BATCH);
  if (isTooLarge(request)) return refuse(413, BAD_BATCH);
  return undefined;
}

/**
 * POST a batch of training results (S6 decisions 2-6); the answer names
 * each result's fate by its id. Recorded for the session account only: a
 * player id in the body is stripped by the schema. The request is counted
 * as a batch before its body is read, so a flood of bad bodies is limited
 * too; a body not declared JSON (415) or declared over 256 KB (413) is
 * refused unread. A parsed batch is counted again by its results, so
 * large batches carry no more results a minute than small ones could.
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getAccount();
  if (account === null) return refuse(401);
  if (accountStage(account) !== 'onboarded') return refuse(403);
  const now = new Date();
  const limited = await countRateLimited(
    getDb(),
    trainingRateKey(account.id),
    TRAINING_RATE_LIMIT,
    now,
  );
  if (!limited.ok) return refuse(429, limited.refusal.reason);
  const unread = refusedUnread(request);
  if (unread !== undefined) return unread;
  const body: unknown = await request.json().catch(() => null);
  const batch = resultBatchSchema.safeParse(body);
  if (!batch.success) return refuse(400, BAD_BATCH);
  const results = await countWeighted(getDb(), {
    key: trainingResultsKey(account.id),
    rule: TRAINING_RESULTS_RATE_LIMIT,
    now,
    weight: batch.data.length,
  });
  if (!results.ok) return refuse(429, results.refusal.reason);
  const answers = await recordResults(getDb(), account.id, batch.data, now);
  return Response.json({ answers }, { headers: NO_STORE });
}
