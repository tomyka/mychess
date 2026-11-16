/**
 * The request rules of the Lichess broadcast API (#349, spec lead decisions
 * 3 and 6, ruling R-199): every call carries the server's `study:read`
 * token, which the caller passes in (this package never reads the
 * environment), and every expected failure is a refusal value the caller
 * acts on: a 429 tells it to wait a minute or stop for the night.
 *
 * No refusal or error made here holds the token.
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';
import {
  discard,
  get,
  jsonOrUndefined,
  readCappedText,
  TooLargeError,
  type Fetch,
} from './http';

/** Why a Lichess broadcast request gave nothing usable. */
export const LICHESS_BROADCAST_REFUSALS = {
  /** 404: no such account, tournament or round, or it is private. */
  notFound: 'lichessBroadcast.notFound',
  /** 429: Lichess asks for a minute's pause before the next request. */
  rateLimited: 'lichessBroadcast.rateLimited',
  /** 401 or 403: the token is missing its scope, revoked or expired. */
  unauthorized: 'lichessBroadcast.unauthorized',
  /** The request failed, or Lichess answered with another error status. */
  unavailable: 'lichessBroadcast.unavailable',
  /** The answer is too large or not in the documented shape. */
  invalid: 'lichessBroadcast.invalid',
} as const;

export interface LichessBroadcastRefusal {
  readonly reason: (typeof LICHESS_BROADCAST_REFUSALS)[keyof typeof LICHESS_BROADCAST_REFUSALS];
}

export type LichessBroadcastResult<T> = Result<T, LichessBroadcastRefusal>;

/** How a client reaches the Lichess API: the fetch and the bearer token. */
export interface LichessApi {
  readonly fetch: Fetch;
  /** A Lichess personal API token with the `study:read` scope. */
  readonly token: string;
}

/** The ID of a Lichess broadcast tournament or round: 8 letters or digits. */
export const LICHESS_BROADCAST_ID = /^[A-Za-z0-9]{8}$/;

/** The message-catalogue key of a token that is no Lichess token. */
export const LICHESS_TOKEN_INVALID = 'lichessBroadcast.tokenInvalid';

/**
 * A Lichess personal API token as Lichess issues them (`lip_...`): letters,
 * digits and `_`, so it is safe in a header. Its one issue message is
 * LICHESS_TOKEN_INVALID, and no issue carries the value. The one definition
 * of a token: the server's environment parses LICHESS_TOKEN with it too.
 */
export const lichessTokenSchema = z
  .string(LICHESS_TOKEN_INVALID)
  .regex(/^[A-Za-z0-9_]{1,256}$/, LICHESS_TOKEN_INVALID);

/** The most bytes of a JSON answer read: a tour with its rounds is far less. */
const JSON_MAX_BYTES = 2 * 1024 * 1024;

const JSON_ANSWER_NAME = 'the Lichess broadcast answer';

const STATUS_REFUSALS: Readonly<
  Partial<Record<number, LichessBroadcastRefusal['reason']>>
> = {
  401: LICHESS_BROADCAST_REFUSALS.unauthorized,
  403: LICHESS_BROADCAST_REFUSALS.unauthorized,
  404: LICHESS_BROADCAST_REFUSALS.notFound,
  429: LICHESS_BROADCAST_REFUSALS.rateLimited,
};

/**
 * Throws unless `id` is a Lichess broadcast ID, so text that could change
 * the path of a URL never reaches one: callers pass IDs they parsed.
 */
export function checkBroadcastId(id: string, what: string): void {
  if (!LICHESS_BROADCAST_ID.test(id)) {
    throw new RangeError(`the ${what} is not a Lichess broadcast ID`);
  }
}

/**
 * GETs `url` with the token. The response when its status is 2xx; a
 * refusal for an error status, whose body is cancelled, or for a failed
 * request. Fails with the abort reason once `signal` is aborted. Throws for
 * a malformed token, before any request and without naming it.
 */
export async function lichessGet(
  api: LichessApi,
  url: string,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<Response>> {
  if (!lichessTokenSchema.safeParse(api.token).success) {
    throw new RangeError('the Lichess token is malformed');
  }
  let response: Response;
  try {
    response = await get(api.fetch, url, signal, {
      Authorization: `Bearer ${api.token}`,
    });
  } catch {
    signal.throwIfAborted();
    return refuse(LICHESS_BROADCAST_REFUSALS.unavailable);
  }
  if (response.ok) return ok(response);
  discard(response);
  return refuse(
    STATUS_REFUSALS[response.status] ?? LICHESS_BROADCAST_REFUSALS.unavailable,
  );
}

/**
 * GETs `url` with the token and parses its JSON answer with `schema`; the
 * refusals of lichessGet, and `invalid` for an answer over 2 MB or not in
 * the schema's shape.
 */
export async function lichessJson<T>(
  api: LichessApi,
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<T>> {
  const answer = await lichessGet(api, url, signal);
  if (!answer.ok) return answer;
  const text = await answerText(answer.value, signal);
  if (!text.ok) return text;
  const parsed = schema.safeParse(jsonOrUndefined(text.value));
  return parsed.success
    ? ok(parsed.data)
    : refuse(LICHESS_BROADCAST_REFUSALS.invalid);
}

/**
 * The body of `response`, read under the cap; fails with the abort reason
 * once `signal` is aborted.
 */
async function answerText(
  response: Response,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<string>> {
  try {
    return ok(
      await readCappedText(response, JSON_MAX_BYTES, signal, JSON_ANSWER_NAME),
    );
  } catch (error) {
    signal.throwIfAborted();
    return refuse(
      error instanceof TooLargeError
        ? LICHESS_BROADCAST_REFUSALS.invalid
        : LICHESS_BROADCAST_REFUSALS.unavailable,
    );
  }
}
