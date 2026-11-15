import {
  constants,
  createZstdCompress,
  zstdCompressSync,
  zstdDecompressSync,
} from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { collectAll, pseudoRandomBytes } from './test-support';
import { zstdFrames } from './zstd-frames';

/** A skippable frame with magic 0x184D2A5`nibble` and `size` bytes of payload. */
function skippable(size: number, nibble = 0): Uint8Array {
  const frame = Buffer.alloc(8 + size, 0xab);
  frame.writeUInt32LE(0x184d2a50 + nibble, 0);
  frame.writeUInt32LE(size, 4);
  return frame;
}

/** `bytes` in chunks of `size`, as the network delivers them. */
async function* chunked(
  bytes: Uint8Array,
  size: number,
): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.byteLength; start += size) {
    await Promise.resolve();
    yield bytes.subarray(start, start + size);
  }
}

/** Each frame `zstdFrames` splits off, as its bytes joined. */
async function framesOf(
  bytes: Uint8Array,
  chunkSize = bytes.byteLength || 1,
  maxFrames = 1000,
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for await (const frame of zstdFrames(chunked(bytes, chunkSize), maxFrames)) {
    frames.push(Buffer.concat(await collectAll(frame)));
  }
  return frames;
}

/** `bytes` compressed as a stream: no content size, a window descriptor. */
async function streamed(bytes: Uint8Array): Promise<Buffer> {
  const compressor = createZstdCompress({
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  });
  compressor.end(bytes);
  return Buffer.concat(await collectAll<Uint8Array>(compressor));
}

const TEXT_A = '[Event "A"]\n';
const TEXT_B = '[Event "B"]\n'.repeat(20_000);

/** Compressed blocks, one and several (over 128 KB of content). */
const A = zstdCompressSync(Buffer.from(TEXT_A));
const B = zstdCompressSync(Buffer.from(TEXT_B));
/** RLE blocks: one byte repeated. */
const RLE = zstdCompressSync(Buffer.alloc(300_000, ' '));
/** Raw blocks with a checksum: random bytes do not compress. */
const RAW = zstdCompressSync(pseudoRandomBytes(300_000), {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
});

/** An empty last raw block: the smallest a frame can end with. */
const EMPTY_LAST_BLOCK = [0x01, 0x00, 0x00];

/** A frame header: magic, `descriptor`, then the header fields it calls for. */
function handBuilt(descriptor: number, fields: readonly number[]): Buffer {
  return Buffer.from([
    0x28,
    0xb5,
    0x2f,
    0xfd,
    descriptor,
    ...fields,
    ...EMPTY_LAST_BLOCK,
  ]);
}

/** The smallest valid frame: single segment, content size 0, empty block. */
const TINY = handBuilt(0x20, [0x00]);

describe('zstdFrames header fields', () => {
  it('reads a 2-byte content size (a frame of about 1000 bytes)', async () => {
    const text = Buffer.from(
      Array.from(pseudoRandomBytes(1000), (byte) => 97 + (byte % 4)),
    );
    const frame = zstdCompressSync(text);
    expect((frame[4] ?? 0) >> 6).toBe(1);
    await expect(framesOf(Buffer.concat([frame, A]), 3)).resolves.toEqual([
      Buffer.from(frame),
      Buffer.from(A),
    ]);
  });

  it.each([
    ['an 8-byte content size', handBuilt(0xe0, [1, 2, 3, 4, 5, 6, 7, 8])],
    ['a 1-byte dictionary id', handBuilt(0x21, [9, 0])],
    ['a 2-byte dictionary id', handBuilt(0x22, [9, 9, 0])],
    ['a 4-byte dictionary id', handBuilt(0x23, [9, 9, 9, 9, 0])],
  ])('ends a frame with %s where its header says', async (_, frame) => {
    await expect(framesOf(Buffer.concat([frame, A]), 2)).resolves.toEqual([
      frame,
      Buffer.from(A),
    ]);
  });
});

describe('zstdFrames frame cap', () => {
  it('reads as many frames as the cap', async () => {
    const dump = Buffer.concat([TINY, skippable(1), TINY]);
    await expect(framesOf(dump, 5, 3)).resolves.toEqual([TINY, TINY]);
  });

  it('fails past the cap, counting skippable frames too', async () => {
    const dump = Buffer.concat([TINY, skippable(1), TINY, TINY]);
    await expect(framesOf(dump, 5, 3)).rejects.toThrow(
      'the zstd stream has more than 3 frames',
    );
  });
});

describe('zstdFrames', () => {
  it.each([1, 7])(
    'splits concatenated frames, skipping skippable ones before and between, in chunks of %s bytes',
    async (size) => {
      const dump = Buffer.concat([
        skippable(4),
        A,
        skippable(0, 0xf),
        B,
        skippable(300, 7),
        A,
      ]);
      await expect(framesOf(dump, size)).resolves.toEqual(
        [A, B, A].map((f) => Buffer.from(f)),
      );
    },
  );

  it('splits frames of RLE and raw blocks, in chunks of any size', async () => {
    // Each frame is about 300 KB on the wire: chunks of a byte or two would
    // take seconds, so the small chunks are tested above.
    const dump = Buffer.concat([RLE, skippable(4), RAW, A]);
    for (const size of [997, 4096, dump.byteLength]) {
      const frames = await framesOf(dump, size);
      expect(frames).toEqual([RLE, RAW, A].map((f) => Buffer.from(f)));
    }
  });

  it('hands each frame on whole, so each decodes alone', async () => {
    const stream = await streamed(Buffer.from(TEXT_B));
    const frames = await framesOf(Buffer.concat([A, stream, B]), 5);
    expect(frames.map((frame) => zstdDecompressSync(frame).toString())).toEqual(
      [TEXT_A, TEXT_B, TEXT_B],
    );
  });

  it('reads an empty stream as no frames', async () => {
    await expect(framesOf(new Uint8Array(0))).resolves.toEqual([]);
  });

  it.each([
    ['text that is not zstd', Buffer.from('[White "plain text"]\n')],
    ['a frame cut short', A.subarray(0, A.byteLength - 1)],
    ['a frame cut in its header', A.subarray(0, 5)],
    ['a magic number cut short', Buffer.concat([A, B.subarray(0, 2)])],
    ['a skippable frame cut short', skippable(10).subarray(0, 12)],
    ['garbage after a frame', Buffer.concat([A, Buffer.from('garbage!')])],
  ])('fails on %s', async (_, bytes) => {
    await expect(framesOf(bytes, 3)).rejects.toThrow(/zstd/);
  });

  it('fails on a frame descriptor with its reserved bit set', async () => {
    const bad = Buffer.from(A);
    bad[4] = (bad[4] ?? 0) | 0x08;
    await expect(framesOf(bad)).rejects.toThrow('reserved bit');
  });

  it('fails on a block of the reserved type', async () => {
    // Magic, descriptor 0x20 (single segment, 1-byte content size), size,
    // then a last block of type 3.
    const bad = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x01, 0x07, 0, 0]);
    await expect(framesOf(bad)).rejects.toThrow('reserved block type');
  });

  it('fails on a block over 128 KB', async () => {
    const size = 128 * 1024 + 1;
    const header = (size << 3) | 1; // last, raw
    const bad = Buffer.from([
      0x28,
      0xb5,
      0x2f,
      0xfd,
      0x20,
      0x01,
      header & 0xff,
      (header >> 8) & 0xff,
      (header >> 16) & 0xff,
    ]);
    await expect(framesOf(bad)).rejects.toThrow('block larger');
  });

  it('fails when a frame is not read to its end before the next', async () => {
    const frames = zstdFrames(chunked(Buffer.concat([A, B]), 4), 10);
    const first = await frames.next();
    expect(first.done).toBe(false);
    await expect(frames.next()).rejects.toThrow('read to its end');
  });
});
