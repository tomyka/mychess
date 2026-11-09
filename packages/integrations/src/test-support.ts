// Test helpers shared by this package's tests: a fetch that answers from a
// table instead of the network, and a signal that never aborts.
import type { Fetch } from './http';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

export type FakeFetch = Fetch & { readonly calls: RecordedCall[] };

/**
 * A fetch answering each URL of `responses` once; any other URL fails the
 * test, so a client fetching a URL it should not is caught.
 */
export function fakeFetch(
  responses: Readonly<Record<string, Response>>,
): FakeFetch {
  const calls: RecordedCall[] = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const response = responses[url];
    return response === undefined
      ? Promise.reject(new Error(`unexpected fetch of ${url}`))
      : Promise.resolve(response);
  };
  return Object.assign(fetch, { calls });
}

export const never: AbortSignal = new AbortController().signal;

/** A response streaming `chunks` one by one, as a slow network would. */
export function streamedResponse(chunks: Iterable<Uint8Array>): Response {
  return trackedResponse(chunks).response;
}

/** A response, and whether its body was cancelled. */
export interface TrackedResponse {
  readonly response: Response;
  readonly cancelled: () => boolean;
}

/** A response streaming `chunks` with `status`, noting a cancel. */
export function trackedResponse(
  chunks: Iterable<Uint8Array>,
  status = 200,
): TrackedResponse {
  const iterator = chunks[Symbol.iterator]();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done === true) controller.close();
      else controller.enqueue(next.value);
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status }),
    cancelled: () => cancelled,
  };
}

/** A response whose body never delivers a byte, noting a cancel. */
export function stalledResponse(): TrackedResponse {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

/** `text` as a stream of chunks of at most `size` characters. */
export async function* textChunks(
  text: string,
  size: number,
): AsyncGenerator<string> {
  for (let start = 0; start < text.length; start += size) {
    await Promise.resolve();
    yield text.slice(start, start + size);
  }
}

/** Every item of `items`, read to the end. */
export async function collectAll<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}
