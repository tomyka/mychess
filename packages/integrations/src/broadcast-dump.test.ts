import { constants, createZstdCompress, zstdCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BROADCAST_DUMP_LIMITS,
  broadcastDumpUrl,
  openBroadcastDump,
} from './broadcast-dump';
import {
  collectAll,
  fakeFetch,
  never,
  pseudoRandomBytes,
  stalledResponse,
  streamedResponse,
  trackedResponse,
} from './test-support';

const MONTH_URL =
  'https://database.lichess.org/broadcast/lichess_db_broadcast_2026-03.pgn.zst';

const MIB = 1024 * 1024;

/** `bytes` split into chunks of `size`, as the network delivers them. */
function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < bytes.byteLength; start += size) {
    chunks.push(bytes.subarray(start, start + size));
  }
  return chunks;
}

/** `frame` `times` times over: zstd reads concatenated frames as one stream. */
function* repeated(frame: Uint8Array, times: number): Generator<Uint8Array> {
  for (let i = 0; i < times; i += 1) yield frame;
}

/** A response delivering `first`, then waiting forever, noting a cancel. */
function stalledAfter(first: Uint8Array): {
  response: Response;
  cancelled: () => boolean;
} {
  let cancelled = false;
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return new Promise<void>(() => undefined);
      sent = true;
      controller.enqueue(first);
      return undefined;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

/** The offset just past the first block of the zstd `frame` (RFC 8878). */
function firstBlockEnd(frame: Uint8Array): number {
  const descriptor = frame[4] ?? 0;
  const singleSegment = (descriptor >> 5) & 1;
  const contentSizeFlag = descriptor >> 6;
  const dictionaryIdFlag = descriptor & 3;
  const start =
    5 +
    (1 - singleSegment) +
    (dictionaryIdFlag === 3 ? 4 : dictionaryIdFlag) +
    (contentSizeFlag === 0 ? singleSegment : 2 ** contentSizeFlag);
  const header = Buffer.from(frame).readUIntLE(start, 3);
  return start + 3 + (header >>> 3);
}

/** A skippable frame, as Lichess dumps start with, of `size` bytes payload. */
function skippable(size: number): Uint8Array {
  const frame = Buffer.alloc(8 + size);
  frame.writeUInt32LE(0x184d2a50, 0);
  frame.writeUInt32LE(size, 4);
  return frame;
}

/** `bytes` as one zstd frame declaring a window of 2^`windowLog` bytes. */
async function framedWithWindow(
  bytes: Uint8Array,
  windowLog: number,
): Promise<Uint8Array> {
  // Streamed, the frame keeps the window asked for rather than one fitted
  // to the content's size.
  const compressor = createZstdCompress({
    params: { [constants.ZSTD_c_windowLog]: windowLog },
  });
  compressor.end(bytes);
  return Buffer.concat(await collectAll<Uint8Array>(compressor));
}

describe('broadcastDumpUrl', () => {
  it('builds the dump URL of a month', () => {
    expect(broadcastDumpUrl('2026-03')).toBe(MONTH_URL);
  });

  it.each(['2026-13', '2026-3', '../x', '2026-03/../../list', ''])(
    'throws for %j, which is no month',
    (month) => {
      expect(() => broadcastDumpUrl(month)).toThrow(RangeError);
    },
  );
});

describe('openBroadcastDump', () => {
  it('streams the decompressed text of the month', async () => {
    const pgn = '[White "Žalgiris, Ąžuolas"]\n\n1. e4 *\n';
    const compressed = zstdCompressSync(Buffer.from(pgn));
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse(split(compressed, 7)),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    expect((await collectAll(text)).join('')).toBe(pgn);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.init.redirect).toBe('error');
  });

  it('keeps a character split between chunks whole', async () => {
    const pgn = 'ą'.repeat(70_000);
    const compressed = zstdCompressSync(Buffer.from(pgn));
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse([compressed]) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    expect((await collectAll(text)).join('')).toBe(pgn);
  });

  it('streams every frame of a dump written as many frames (pzstd style)', async () => {
    const games = ['[Event "A"]\n\n1. e4 *\n', '[Event "B"]\n\n1. d4 *\n', 'ž'];
    const dump = Buffer.concat([
      skippable(4),
      zstdCompressSync(Buffer.from(games[0] ?? '')),
      zstdCompressSync(Buffer.from(games[1] ?? '')),
      skippable(16),
      zstdCompressSync(Buffer.from(games[2] ?? '')),
    ]);
    for (const chunks of [[dump], split(dump, 7)]) {
      const fetch = fakeFetch({ [MONTH_URL]: streamedResponse(chunks) });
      const { text } = await openBroadcastDump(fetch, '2026-03', never);
      expect((await collectAll(text)).join('')).toBe(games.join(''));
    }
  });

  it('fails on garbage between frames, after the text before it', async () => {
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse([
        zstdCompressSync(Buffer.from('[Event "A"]\n')),
        Buffer.from('garbage!'),
      ]),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    const read: string[] = [];
    const reading = (async () => {
      for await (const chunk of text) read.push(chunk);
    })();
    await expect(reading).rejects.toThrow('zstd stream is malformed');
    expect(read.join('')).toBe('[Event "A"]\n');
  });

  it('fails on a corrupt frame at once, while the next chunk never arrives', async () => {
    // 40 000 event lines with random ids: about 200 KB in several blocks.
    // Their repeats make the decoder check sequences, so it sees the
    // corruption (random letters alone would decode to other letters,
    // unnoticed). The chunk ends right after the corrupt first block, so
    // the frame's reader is already waiting on the next chunk when the
    // decoder fails: that wait must not hold the failure back.
    const ids = Buffer.from(pseudoRandomBytes(160_000)).toString('hex');
    const text = Array.from(
      { length: 40_000 },
      (_, i) => `[Event "${ids.slice(i * 8, i * 8 + 8)}"]\n`,
    ).join('');
    const corrupt = Buffer.from(zstdCompressSync(Buffer.from(text)));
    for (let i = 40; i < 200; i += 1) corrupt[i] = (corrupt[i] ?? 0) ^ 0x5a;
    const answer = stalledAfter(corrupt.subarray(0, firstBlockEnd(corrupt)));
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const { text: dumpText } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(dumpText)).rejects.toThrow(/corrupt/i);
    expect(answer.cancelled()).toBe(true);
  });

  it('fails past 100 000 frames', async () => {
    expect(BROADCAST_DUMP_LIMITS.zstdFrames).toBe(100_000);
    const empty = skippable(0);
    const dump = Buffer.concat(
      Array.from({ length: BROADCAST_DUMP_LIMITS.zstdFrames + 1 }, () => empty),
    );
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse([dump]) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(text)).rejects.toThrow(
      'the zstd stream has more than 100000 frames',
    );
  });

  it('fails on a dump cut inside a frame', async () => {
    const frame = zstdCompressSync(Buffer.from('[Event "A"]\n'.repeat(100)));
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse([frame.subarray(0, frame.byteLength - 3)]),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(text)).rejects.toThrow('ends inside a frame');
  });

  it('fails when the dump answers with an error status', async () => {
    const fetch = fakeFetch({
      [MONTH_URL]: new Response('missing', { status: 404 }),
    });
    await expect(openBroadcastDump(fetch, '2026-03', never)).rejects.toThrow(
      'answered 404',
    );
  });

  it('fails on a dump that is not zstd', async () => {
    const fetch = fakeFetch({
      [MONTH_URL]: new Response('[White "plain text"]\n'),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(text)).rejects.toThrow();
  });
});

describe('openBroadcastDump size caps', () => {
  /**
   * Small caps, so each test moves kilobytes, not the real 100 MB and 1 GB:
   * the cap logic is the same, and the defaults are asserted below.
   */
  const SMALL = {
    ...BROADCAST_DUMP_LIMITS,
    compressedBytes: 64 * 1024,
    decompressedBytes: MIB,
  };

  /** Every text chunk of `month`'s dump read under SMALL; the chars read. */
  async function readSmall(
    chunks: Iterable<Uint8Array>,
  ): Promise<{ read: number; error: unknown }> {
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse(chunks) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never, SMALL);
    let read = 0;
    try {
      for await (const chunk of text) read += chunk.length;
      return { read, error: undefined };
    } catch (error) {
      return { read, error };
    }
  }

  it('defaults to 100 MB compressed, 1 GB decompressed, 100 000 frames and a 128 MB window', () => {
    expect(BROADCAST_DUMP_LIMITS).toEqual({
      compressedBytes: 100 * MIB,
      decompressedBytes: 1024 * MIB,
      zstdFrames: 100_000,
      zstdWindowLog: 27,
    });
  });

  /** Incompressible 16 KB frames, padded by a skippable frame to `total`. */
  function framesOfTotal(total: number): Uint8Array[] {
    const frame = zstdCompressSync(pseudoRandomBytes(16 * 1024));
    const frames = repeated(frame, 3);
    const padding = total - 3 * frame.byteLength - 8;
    return [...frames, skippable(padding)];
  }

  it('reads a dump of exactly the compressed cap', async () => {
    const chunks = framesOfTotal(64 * 1024);
    expect(Buffer.concat(chunks).byteLength).toBe(64 * 1024);
    const { read, error } = await readSmall(chunks);
    expect(error).toBeUndefined();
    expect(read).toBeGreaterThan(0);
  });

  it('fails once the compressed bytes pass the cap, counted across chunks', async () => {
    const { error } = await readSmall(framesOfTotal(64 * 1024 + 1));
    expect(String(error)).toContain('larger than 65536 bytes');
  });

  // Spaces compress to almost nothing: each frame is a small decompression
  // bomb. The frames arrive in one chunk after a skippable frame, so the
  // cap is counted across frames inside one chunk.
  const QUARTER = zstdCompressSync(Buffer.alloc(MIB / 4, ' '));

  it('reads a dump of exactly the decompressed cap', async () => {
    const dump = Buffer.concat([skippable(8), ...repeated(QUARTER, 4)]);
    await expect(readSmall([dump])).resolves.toEqual({
      read: MIB,
      error: undefined,
    });
  });

  it('fails once the decompressed bytes pass the cap, across frames in one chunk', async () => {
    const dump = Buffer.concat([skippable(8), ...repeated(QUARTER, 5)]);
    const { read, error } = await readSmall([dump]);
    expect(String(error)).toContain('larger than 1048576 bytes');
    expect(read).toBeLessThanOrEqual(MIB);
  });
});

describe('openBroadcastDump stops', () => {
  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    const frame = zstdCompressSync(Buffer.alloc(MIB, ' '));
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse(repeated(frame, 50)),
    });
    const { text } = await openBroadcastDump(
      fetch,
      '2026-03',
      controller.signal,
    );
    const reading = (async () => {
      for await (const chunk of text) {
        if (chunk.length > 0) controller.abort(new Error('timed out'));
      }
    })();
    await expect(reading).rejects.toThrow('timed out');
  });

  it('stops reading the download when the reader stops early', async () => {
    // Incompressible frames, so buffers between the stages fill by size.
    const frame = zstdCompressSync(pseudoRandomBytes(64 * 1024));
    let pulled = 0;
    function* counted(): Generator<Uint8Array> {
      for (let i = 0; i < 1000; i += 1) {
        pulled += 1;
        yield frame;
      }
    }
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse(counted()) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    for await (const chunk of text) {
      if (chunk.length > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pulled).toBeLessThan(100);
  });

  it('fails on a frame needing a window over 128 MB (2^27 bytes)', async () => {
    const frame = await framedWithWindow(Buffer.from('[White "w"]\n'), 28);
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse([frame]) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(text)).rejects.toThrow(/memory|window/i);
  });

  it('reads a frame needing a window of 128 MB', async () => {
    const frame = await framedWithWindow(Buffer.from('[White "w"]\n'), 27);
    const fetch = fakeFetch({ [MONTH_URL]: streamedResponse([frame]) });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    expect((await collectAll(text)).join('')).toBe('[White "w"]\n');
  });

  it('cancels the body of an error answer', async () => {
    const answer = trackedResponse([new Uint8Array(3)], 503);
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    await expect(openBroadcastDump(fetch, '2026-03', never)).rejects.toThrow(
      'answered 503',
    );
    expect(answer.cancelled()).toBe(true);
  });
});

describe('openBroadcastDump teardown of a dump never read', () => {
  it('tears down on close: the body is cancelled and reading fails', async () => {
    const answer = stalledResponse();
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const dump = await openBroadcastDump(fetch, '2026-03', never);
    dump.close();
    expect(answer.cancelled()).toBe(true);
    await expect(collectAll(dump.text)).rejects.toThrow();
  });

  it('tears down when disposed', async () => {
    const answer = stalledResponse();
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const dump = await openBroadcastDump(fetch, '2026-03', never);
    await dump[Symbol.asyncDispose]();
    expect(answer.cancelled()).toBe(true);
    await expect(collectAll(dump.text)).rejects.toThrow();
  });

  it('tears down when the signal is aborted', async () => {
    const controller = new AbortController();
    const answer = stalledResponse();
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const dump = await openBroadcastDump(fetch, '2026-03', controller.signal);
    controller.abort(new Error('timed out'));
    expect(answer.cancelled()).toBe(true);
    await expect(collectAll(dump.text)).rejects.toThrow('timed out');
  });

  it('tears down at once on a signal aborted before the answer', async () => {
    const controller = new AbortController();
    const answer = stalledResponse();
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    controller.abort('no reason given as an Error');
    const dump = await openBroadcastDump(fetch, '2026-03', controller.signal);
    expect(answer.cancelled()).toBe(true);
    await expect(collectAll(dump.text)).rejects.toThrow('aborted');
  });

  it('closes twice without harm, and stops listening to the signal', async () => {
    const controller = new AbortController();
    const answer = stalledResponse();
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const dump = await openBroadcastDump(fetch, '2026-03', controller.signal);
    dump.close();
    dump.close();
    controller.abort(new Error('late'));
    await expect(collectAll(dump.text)).rejects.toThrow('was closed');
  });

  it('closes without harm once the text was read to its end', async () => {
    const answer = trackedResponse([zstdCompressSync(Buffer.from('x'))]);
    const fetch = fakeFetch({ [MONTH_URL]: answer.response });
    const dump = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(dump.text)).resolves.toEqual(['x']);
    dump.close();
  });
});

/**
 * The errors raised outside any reader while `action` runs and a little
 * after: a stream destroyed with no one listening raises its reason as an
 * uncaught exception on a later tick.
 */
async function uncaughtDuring(action: () => Promise<void>): Promise<unknown[]> {
  const raised: unknown[] = [];
  const onError = (error: unknown): void => {
    raised.push(error);
  };
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  try {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off('uncaughtException', onError);
    process.off('unhandledRejection', onError);
  }
  return raised;
}

describe('openBroadcastDump teardown raises nothing outside its reader', () => {
  // About 440 KB: several blocks, so text comes before the last one.
  const PGN = '[Event "A"]\n\n1. e4 *\n'.repeat(20_000);

  it('when closed before reading', async () => {
    const raised = await uncaughtDuring(async () => {
      const fetch = fakeFetch({ [MONTH_URL]: stalledResponse().response });
      const dump = await openBroadcastDump(fetch, '2026-03', never);
      dump.close();
    });
    expect(raised).toEqual([]);
  });

  it('when closed mid-frame, its text read in part', async () => {
    const frame = zstdCompressSync(Buffer.from(PGN));
    const answer = stalledAfter(frame.subarray(0, frame.byteLength - 10));
    const raised = await uncaughtDuring(async () => {
      const fetch = fakeFetch({ [MONTH_URL]: answer.response });
      const dump = await openBroadcastDump(fetch, '2026-03', never);
      const reader = dump.text[Symbol.asyncIterator]();
      await reader.next();
      dump.close();
    });
    expect(raised).toEqual([]);
    expect(answer.cancelled()).toBe(true);
  });

  it('when disposed after an abort while idle', async () => {
    const controller = new AbortController();
    const raised = await uncaughtDuring(async () => {
      const fetch = fakeFetch({ [MONTH_URL]: stalledResponse().response });
      const dump = await openBroadcastDump(fetch, '2026-03', controller.signal);
      controller.abort(new Error('idle too long'));
      await dump[Symbol.asyncDispose]();
    });
    expect(raised).toEqual([]);
  });

  it('when a reader stops early and the dump is disposed', async () => {
    const raised = await uncaughtDuring(async () => {
      const fetch = fakeFetch({
        [MONTH_URL]: streamedResponse([zstdCompressSync(Buffer.from(PGN))]),
      });
      await using dump = await openBroadcastDump(fetch, '2026-03', never);
      for await (const chunk of dump.text) {
        if (chunk.length > 0) break;
      }
    });
    expect(raised).toEqual([]);
  });
});
