import { randomBytes } from 'node:crypto';
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

  it('fails once the compressed bytes pass 100 MB', async () => {
    expect(BROADCAST_DUMP_LIMITS.compressedBytes).toBe(100 * MIB);
    // Random bytes do not compress, so each frame is about 1 MB on the wire.
    const frame = zstdCompressSync(randomBytes(MIB));
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse(repeated(frame, 101)),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    await expect(collectAll(text)).rejects.toThrow(
      'larger than 104857600 bytes',
    );
  });

  it('fails once the decompressed bytes pass 1 GB', async () => {
    expect(BROADCAST_DUMP_LIMITS.decompressedBytes).toBe(1024 * MIB);
    // 64 MB of spaces compress to a few kilobytes: a small decompression bomb.
    const frame = zstdCompressSync(Buffer.alloc(64 * MIB, ' '));
    const fetch = fakeFetch({
      [MONTH_URL]: streamedResponse(repeated(frame, 17)),
    });
    const { text } = await openBroadcastDump(fetch, '2026-03', never);
    let read = 0;
    const reading = (async () => {
      for await (const chunk of text) read += chunk.length;
    })();
    await expect(reading).rejects.toThrow('larger than 1073741824 bytes');
    expect(read).toBeLessThanOrEqual(1024 * MIB);
  }, 30_000);

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
    const frame = zstdCompressSync(randomBytes(64 * 1024));
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
