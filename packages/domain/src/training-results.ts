/**
 * The result-batch protocol between the browser's queue and
 * `POST /api/training/results` (S6 decisions 2-3, #299): the batch the
 * browser sends, the answer per result, what each status means, and which
 * queued results the browser drops on a given reply.
 */
import { z } from 'zod';
import {
  RESULT_KINDS,
  TRAINING_REFUSALS,
  type TrainingRefusal,
} from './training';
import { TRAINING_RATE_LIMIT, TRAINING_RESULTS_RATE_LIMIT } from './rate-limit';

/** Every issue of a batch: the batch can never be recorded as sent. */
const error = TRAINING_REFUSALS.badBatch;

/** One answer the browser queued (S6 decision 1). */
export const trainingResultSchema = z.object(
  {
    resultId: z.uuid({ error }),
    kind: z.enum(RESULT_KINDS, { error }),
    moveKey: z.string({ error }).min(3, { error }).max(200, { error }),
    repertoireId: z.uuid({ error }),
    answeredAt: z.coerce.date({ error }),
  },
  { error },
);
export type TrainingResult = z.infer<typeof trainingResultSchema>;
export const MAX_RESULT_BATCH = 200;
/** The request body: 1 to 200 results; a player id in it is stripped. */
export const resultBatchSchema = z
  .array(trainingResultSchema, { error })
  .min(1, { error })
  .max(MAX_RESULT_BATCH, { error });

/**
 * The largest body a batch is read from: the largest batch is far smaller.
 * A body with no declared length is left to the platform's own cap.
 */
export const MAX_BATCH_BODY_BYTES = 256 * 1024;

/** What became of one result: recorded in some way, or refused. */
export type ResultStatus = 'applied' | 'stale' | 'duplicate' | TrainingRefusal;

/** What became of one result of a batch, as the server answers it. */
export type ResultAnswer =
  | {
      readonly resultId: string;
      readonly status: 'applied' | 'stale' | 'duplicate';
    }
  | {
      readonly resultId: string;
      readonly status: 'refused';
      readonly reason: TrainingRefusal['reason'];
    };

export const resultAnswer = (
  resultId: string,
  status: ResultStatus,
): ResultAnswer =>
  typeof status === 'string'
    ? { resultId, status }
    : { resultId, status: 'refused', reason: status.reason };

/** A request refused from its headers, before its body is read. */
interface UnreadRefusal {
  readonly kind: 'tooLarge' | 'notJson';
}

/**
 * Whether a result's fate is written to the results log (S6 decision 3):
 * every one but a duplicate, already logged, and a result naming nothing
 * the player holds (training.notHeld), which a forged batch could repeat
 * at will and which says nothing of the player's training.
 */
export const isLogged = (status: ResultStatus): boolean =>
  typeof status === 'string'
    ? status !== 'duplicate'
    : status.reason !== TRAINING_REFUSALS.notHeld;

/** Why the endpoint's rate limits refuse a request. */
type RateLimitReason = (
  typeof TRAINING_RATE_LIMIT | typeof TRAINING_RESULTS_RATE_LIMIT
)['reason'];

/** How the endpoint ended a request. */
export type BatchOutcome =
  | { readonly kind: 'recorded'; readonly answers: readonly ResultAnswer[] }
  | { readonly kind: 'rateLimited'; readonly reason: RateLimitReason }
  | { readonly kind: 'unauthenticated' | 'notOnboarded' | 'malformed' }
  | UnreadRefusal;

/** The answers, a refusal's reason, or nothing. */
type BatchBody =
  | { readonly answers: readonly ResultAnswer[] }
  | {
      readonly reason: RateLimitReason | (typeof TRAINING_REFUSALS)['badBatch'];
    }
  | null;

interface BatchResponse {
  readonly status: number;
  readonly body: BatchBody;
}

const badBatch = (status: number): BatchResponse => ({
  status,
  body: { reason: TRAINING_REFUSALS.badBatch },
});

/** The HTTP status and JSON body the endpoint answers `outcome` with. */
export function batchResponse(outcome: BatchOutcome): BatchResponse {
  switch (outcome.kind) {
    case 'recorded':
      return { status: 200, body: { answers: outcome.answers } };
    case 'rateLimited':
      return { status: 429, body: { reason: outcome.reason } };
    case 'unauthenticated':
      return { status: 401, body: null };
    case 'notOnboarded':
      return { status: 403, body: null };
    case 'malformed':
      return badBatch(400);
    case 'tooLarge':
      return badBatch(413);
    case 'notJson':
      return badBatch(415);
  }
}

/**
 * Refusals that say the batch can never be recorded as sent: malformed,
 * refused for the account, too large or not JSON. Signed out is not among
 * them, as the session may come back after signing in; a rate limit and a
 * 5xx are kept for the next flush too.
 */
const NEVER_RECORDABLE = [
  'malformed',
  'notOnboarded',
  'tooLarge',
  'notJson',
] as const satisfies readonly BatchOutcome['kind'][];

const DROPPED_STATUSES: ReadonlySet<number> = new Set(
  NEVER_RECORDABLE.map((kind) => batchResponse({ kind }).status),
);

/** The request headers a batch is refused by before its body is read. */
interface BatchHeaders {
  readonly contentType: string | null;
  readonly contentLength: string | null;
}

/**
 * Whether the body is declared JSON. A cross-site form can post only
 * form encodings or text/plain without a preflight, so refusing anything
 * else is a cheap guard against a forged post.
 */
const isJson = (contentType: string | null): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

/** Whether the body is declared longer than any batch could be. */
const isTooLarge = (contentLength: string | null): boolean =>
  Number(contentLength ?? 0) > MAX_BATCH_BODY_BYTES;

/**
 * Why a request is refused before its body is read, or undefined: a body
 * not declared JSON, or declared over MAX_BATCH_BODY_BYTES.
 */
export function unreadRefusal(
  headers: BatchHeaders,
): UnreadRefusal | undefined {
  if (!isJson(headers.contentType)) return { kind: 'notJson' };
  if (isTooLarge(headers.contentLength)) return { kind: 'tooLarge' };
  return undefined;
}

/**
 * One answer as the browser reads it: a refusal's reason is any string, so
 * a reason added later still drops its result rather than the whole reply.
 */
const answerSchema = z.discriminatedUnion('status', [
  z.object({
    resultId: z.string(),
    status: z.enum(['applied', 'stale', 'duplicate']),
  }),
  z.object({
    resultId: z.string(),
    status: z.literal('refused'),
    reason: z.string(),
  }),
]);

const answersBodySchema = z.object({ answers: z.array(answerSchema) });

/** The server's reply to a posted batch: its status and JSON body. */
interface BatchReply {
  readonly status: number;
  readonly body: unknown;
}

/**
 * What the browser does with a posted batch: keep it all for the next
 * flush, drop it all as never recordable, or drop the results answered.
 */
type FlushVerdict =
  | { readonly kind: 'kept'; readonly drop: ReadonlySet<string> }
  | {
      readonly kind: 'batchRefused';
      readonly status: number;
      readonly drop: ReadonlySet<string>;
    }
  | {
      readonly kind: 'answered';
      readonly drop: ReadonlySet<string>;
      /** Each refused result's reason, to log: never a move or an id. */
      readonly refused: readonly string[];
    };

const kept = (): FlushVerdict => ({ kind: 'kept', drop: new Set() });

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

/**
 * The browser's drop-or-keep rule for a posted `batch`. No reply (a network
 * error), a 401, a 429, a 5xx or a 2xx that is no answer keeps it all; a
 * never-recordable refusal (400, 403, 413, 415) drops it all; otherwise
 * every result the server answered is dropped: applied, stale, duplicate
 * and refused alike.
 */
export function settleFlush(
  batch: readonly { readonly resultId: string }[],
  reply: BatchReply | undefined,
): FlushVerdict {
  if (reply === undefined) return kept();
  if (DROPPED_STATUSES.has(reply.status)) {
    return {
      kind: 'batchRefused',
      status: reply.status,
      drop: new Set(batch.map(({ resultId }) => resultId)),
    };
  }
  if (!isSuccess(reply.status)) return kept();
  const parsed = answersBodySchema.safeParse(reply.body);
  if (!parsed.success) return kept();
  const { answers } = parsed.data;
  return {
    kind: 'answered',
    drop: new Set(answers.map(({ resultId }) => resultId)),
    refused: answers.flatMap((a) => (a.status === 'refused' ? [a.reason] : [])),
  };
}
