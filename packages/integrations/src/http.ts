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

/** GETs `url` under the shared rules, whatever the status. */
export function get(
  fetch: Fetch,
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    redirect: 'error',
    signal,
    headers: { 'User-Agent': USER_AGENT },
  });
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
      throw new Error(`${what} is larger than ${String(maxBytes)} bytes`);
    }
    yield chunk;
  }
}

/** A response's body chunks; none for a response without a body. */
function bodyOf(response: Response): Chunks {
  return response.body ?? [];
}

/** A whole response body as UTF-8 text of at most `maxBytes` bytes. */
export async function readCappedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  what: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of cappedBytes(
    bodyOf(response),
    maxBytes,
    signal,
    what,
  )) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
