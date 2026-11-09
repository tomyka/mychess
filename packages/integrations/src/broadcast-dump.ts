/**
 * A month's Lichess broadcast dump, downloaded, decompressed and decoded in
 * one streamed pass (#316, spec decision 2): nothing is held whole in memory
 * or written to disk, and each stage is capped while it streams.
 */
import { pipeline, Readable } from 'node:stream';
import { constants, createZstdDecompress } from 'node:zlib';
import { cappedBytes, getOk, type Fetch } from './http';
import { MONTH_FORMAT } from './month-format';

/** The size caps of one month's dump (security requirements, task 1). */
export const BROADCAST_DUMP_LIMITS = {
  compressedBytes: 100 * 1024 * 1024,
  decompressedBytes: 1024 * 1024 * 1024,
  /**
   * The largest zstd window a frame may ask for, as a power of two: 2^27
   * bytes, 128 MB, so a frame cannot make the decoder allocate more.
   */
  zstdWindowLog: 27,
} as const;

/** Checked here because the month becomes part of a URL. */
const MONTH = new RegExp(`^${MONTH_FORMAT}$`);

/**
 * An opened dump: its PGN text, read on demand, and the teardown of the
 * download behind it. Close it (or `await using` it) once done, whether or
 * not the text was read.
 */
export interface BroadcastDump extends AsyncDisposable {
  readonly text: AsyncIterable<string>;
  /** Stops the download and the decompression; reading then fails. */
  close(): void;
}

/**
 * The dump URL of `month`, built from a constant. Throws for text that is
 * not a `YYYY-MM` month: callers pass a month they parsed.
 */
export function broadcastDumpUrl(month: string): string {
  if (!MONTH.test(month)) {
    throw new RangeError(`${JSON.stringify(month)} is not a YYYY-MM month`);
  }
  return `https://database.lichess.org/broadcast/lichess_db_broadcast_${month}.pgn.zst`;
}

/**
 * Opens `month`'s dump. Fails when the download answers with an error
 * status. Reading the text fails once the compressed or decompressed bytes
 * pass BROADCAST_DUMP_LIMITS, a frame asks for a larger window, or the dump
 * is closed. Aborting `signal` closes the dump, read or not; a reader that
 * stops early or reaches the end closes it too.
 */
export async function openBroadcastDump(
  fetch: Fetch,
  month: string,
  signal: AbortSignal,
): Promise<BroadcastDump> {
  const response = await getOk(fetch, broadcastDumpUrl(month), signal);
  return dumpOf(response, signal, `the ${month} broadcast dump`);
}

function dumpOf(
  response: Response,
  signal: AbortSignal,
  what: string,
): BroadcastDump {
  const body = response.body?.getReader();
  const decompressor = createZstdDecompress({
    params: {
      [constants.ZSTD_d_windowLogMax]: BROADCAST_DUMP_LIMITS.zstdWindowLog,
    },
  });
  const compressed = cappedBytes(
    bodyChunks(body),
    BROADCAST_DUMP_LIMITS.compressedBytes,
    signal,
    what,
  );
  // pipeline destroys every stage with the first error, so the reader of
  // `decompressor` sees it; destroying again here is a no-op kept to make
  // that hand-over explicit.
  pipeline(Readable.from(compressed), decompressor, (error) => {
    if (error) decompressor.destroy(error);
  });
  let open = true;
  const close = (reason: Error): void => {
    if (!open) return;
    open = false;
    signal.removeEventListener('abort', onAbort);
    decompressor.destroy(reason);
    // The body is cancelled through the reader that holds it, which also
    // ends a read waiting on the network. A cancel that fails means the
    // body already failed, and that failure reaches the text's reader
    // through the pipeline.
    body?.cancel(reason).catch(() => undefined);
  };
  const onAbort = (): void => {
    close(abortReason(signal, what));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const closed = (): void => {
    close(new Error(`${what} was closed`));
  };
  const decompressed = cappedBytes(
    decompressor,
    BROADCAST_DUMP_LIMITS.decompressedBytes,
    signal,
    `${what}, decompressed,`,
  );
  return {
    text: utf8Text(decompressed, closed),
    close: closed,
    [Symbol.asyncDispose]: () => {
      closed();
      return Promise.resolve();
    },
  };
}

function abortReason(signal: AbortSignal, what: string): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`${what} was aborted`);
}

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

async function* utf8Text(
  bytes: AsyncIterable<Uint8Array>,
  onEnd: () => void,
): AsyncGenerator<string> {
  try {
    const decoder = new TextDecoder();
    for await (const chunk of bytes) {
      yield decoder.decode(chunk, { stream: true });
    }
    const rest = decoder.decode();
    if (rest !== '') yield rest;
  } finally {
    onEnd();
  }
}
