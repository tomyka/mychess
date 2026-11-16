/**
 * The outbound HTTP rules every client here shares (#316, security
 * requirements of task 1): the app names itself, never follows a redirect,
 * and counts the bytes it reads so an oversized answer aborts while it
 * streams, not after it is held in memory.
 */

/** The `fetch` a client is given, so tests replay answers offline. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Bytes as they stream in, or as a list. */
export type Chunks = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/** How the app identifies itself to the sources it reads. */
export const USER_AGENT = 'MyChess (+https://mychess.lt)';

/**
 * GETs `url` and returns the response when its status is 2xx; fails
 * otherwise. A redirect fails too: every URL is built from a constant, so
 * one pointing elsewhere is not followed.
 */
export async function getOk(
  fetch: Fetch,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await get(fetch, url, signal);
  if (!response.ok) {
    discard(response);
    throw new Error(`GET ${url} answered ${String(response.status)}`);
  }
  return response;
}

/**
 * Cancels the body of a response that is not read, so its connection is
 * freed. A cancel that fails means the body already failed: nothing is left
 * to free.
 */
export function discard(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

/**
 * GETs `url` under the shared rules, whatever the status, sending `headers`
 * besides the User-Agent.
 */
export function get(
  fetch: Fetch,
  url: string,
  signal: AbortSignal,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return fetch(url, {
    redirect: 'error',
    signal,
    headers: { ...headers, 'User-Agent': USER_AGENT },
  });
}

/** The failure of a stream read past its byte cap. */
export class TooLargeError extends Error {
  override readonly name = 'TooLargeError';
}

/**
 * The chunks of `chunks`, failing once more than `maxBytes` were read or
 * `signal` is aborted. `what` names the stream in the error.
 */
export async function* cappedBytes(
  chunks: Chunks,
  maxBytes: number,
  signal: AbortSignal,
  what: string,
): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new TooLargeError(
        `${what} is larger than ${String(maxBytes)} bytes`,
      );
    }
    yield chunk;
  }
}

/**
 * A whole response body as UTF-8 text of at most `maxBytes` bytes. Aborting
 * `signal` cancels the body, so a read waiting on the network ends, and
 * fails with the abort reason; a read that fails otherwise cancels the body
 * too.
 */
export async function readCappedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  what: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of readBody(response, maxBytes, signal, what).chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * A response body read under the shared rules, which hold here once:
 * capped, cancelled on abort, cancelled however reading ends, and never
 * taken for whole when it was cut short.
 */
export interface BodyReader {
  /**
   * The body's chunks, read once, on demand. Fails once more than the cap
   * was read, with the reason once cancelled or `signal` is aborted (a
   * cancelled body's reads end, so the end is checked), or as the body
   * fails. However reading ends, early or not, the body is cancelled, so
   * its connection is freed.
   */
  readonly chunks: AsyncGenerator<Uint8Array>;
  /**
   * Cancels the body, which also ends a read waiting on the network;
   * reading then fails with `reason`. Only the first call counts.
   */
  cancel(reason: unknown): void;
}

/**
 * Reads `response`'s body, failing past `maxBytes`; `what` names it in the
 * error. Aborting `signal` cancels the body, read or not, with the abort
 * reason.
 */
export function readBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  what: string,
): BodyReader {
  const reader = response.body?.getReader();
  let cancelled: { readonly reason: unknown } | undefined;
  const release = (reason?: unknown): void => {
    signal.removeEventListener('abort', onAbort);
    // A cancel that fails means the body already failed: nothing to free.
    reader?.cancel(reason).catch(() => undefined);
  };
  const cancel = (reason: unknown): void => {
    if (cancelled !== undefined) return;
    cancelled = { reason };
    release(reason);
  };
  const onAbort = (): void => {
    cancel(signal.reason);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      yield* cappedBytes(bodyChunks(reader), maxBytes, signal, what);
      if (cancelled !== undefined) throw cancelled.reason;
      signal.throwIfAborted();
    } finally {
      release();
    }
  }
  return { chunks: chunks(), cancel };
}

/** The chunks a body reader delivers; none without a reader. */
async function* bodyChunks(
  body: ReadableStreamDefaultReader<Uint8Array> | undefined,
): AsyncGenerator<Uint8Array> {
  if (body === undefined) return;
  for (;;) {
    const next = await body.read();
    if (next.done) return;
    yield next.value;
  }
}

/** `text` parsed as JSON; undefined, which a schema refuses, when it is not. */
export function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
