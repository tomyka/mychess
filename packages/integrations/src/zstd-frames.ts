/**
 * The frames of a zstd stream, split as it streams (#357). Lichess writes
 * its broadcast dumps as many zstd frames after a skippable frame (pzstd
 * style), and Node's zstd decoder stops at the end of the frame it started
 * on, so each frame must be decoded on its own. The splitter walks the
 * frame format of RFC 8878 (section 3.1): it reads headers, never decodes,
 * and fails on anything that is not a well-formed sequence of frames.
 */

/**
 * A piece of a zstd frame's bytes, the end of that frame, or the end of the
 * stream, which comes only between frames.
 */
type Segment =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'end' }
  | { readonly kind: 'done' };

const DONE: Segment = { kind: 'done' };

const ZSTD_MAGIC = 0xfd2fb528;

/** Skippable frames have the magic numbers 0x184D2A50 to 0x184D2A5F. */
const SKIPPABLE_MAGIC = 0x184d2a50;

const MAGIC_BYTES = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd);

/** The largest block a frame may hold (RFC 8878, Block_Maximum_Size). */
const MAX_BLOCK_BYTES = 128 * 1024;

/** The size of the Dictionary_ID field by its flag: 0, 1, 2 or 4 bytes. */
function dictionaryIdBytes(flag: number): number {
  return flag === 3 ? 4 : flag;
}

/**
 * The size of the Frame_Content_Size field by its flag: 2, 4 or 8 bytes,
 * and for flag 0 one byte in a single-segment frame, else none.
 */
function contentSizeBytes(flag: number, singleSegment: boolean): number {
  if (flag !== 0) return 2 ** flag;
  return singleSegment ? 1 : 0;
}

const RLE_BLOCK = 1;
const RESERVED_BLOCK = 3;

/**
 * Where the splitter is: reading a field it parses (`field` collects it),
 * or passing over bytes it does not (a block's content, a skippable
 * frame's payload).
 */
type Step =
  | 'magic'
  | 'skippableSize'
  | 'skippablePayload'
  | 'descriptor'
  | 'header'
  | 'blockHeader'
  | 'blockContent'
  | 'checksum';

const PASSED_OVER: ReadonlySet<Step> = new Set([
  'skippablePayload',
  'blockContent',
]);

function malformed(what: string): Error {
  return new Error(`the zstd stream is malformed: ${what}`);
}

function littleEndian(bytes: readonly number[]): number {
  return bytes.reduceRight((value, byte) => value * 256 + byte, 0);
}

/** Splits zstd bytes, pushed chunk by chunk, into the pieces of each frame. */
class FrameSplitter {
  private step: Step = 'magic';
  private need = 4;
  private field: number[] = [];
  private inFrame = false;
  private checksum = false;
  private lastBlock = false;
  private out: Segment[] = [];
  private frames = 0;
  private readonly maxFrames: number;

  /** A splitter failing past `maxFrames` frames, skippable ones included. */
  constructor(maxFrames: number) {
    this.maxFrames = maxFrames;
  }

  /** The segments `chunk` completes or continues. */
  push(chunk: Uint8Array): Segment[] {
    this.out = [];
    let at = 0;
    while (at < chunk.byteLength) {
      const piece = chunk.subarray(at, at + this.need);
      at += piece.byteLength;
      this.need -= piece.byteLength;
      this.take(piece);
      while (this.need === 0) this.advance();
    }
    return this.out;
  }

  /** The end of the stream; fails unless it ended between frames. */
  finish(): Segment {
    if (this.step !== 'magic' || this.field.length > 0) {
      throw malformed('it ends inside a frame');
    }
    return DONE;
  }

  private take(piece: Uint8Array): void {
    if (!PASSED_OVER.has(this.step)) this.field.push(...piece);
    if (this.inFrame) this.emit(piece);
  }

  private emit(bytes: Uint8Array): void {
    this.out.push({ kind: 'bytes', bytes });
  }

  /** Acts on the field or bytes just completed, and sets the next step. */
  private advance(): void {
    const field = this.field;
    this.field = [];
    STEPS[this.step](this, field);
  }

  next(step: Step, need: number): void {
    this.step = step;
    this.need = need;
  }

  readMagic(field: readonly number[]): void {
    this.frames += 1;
    if (this.frames > this.maxFrames) {
      throw new Error(
        `the zstd stream has more than ${String(this.maxFrames)} frames`,
      );
    }
    const magic = littleEndian(field);
    if (magic === ZSTD_MAGIC) {
      this.inFrame = true;
      this.emit(MAGIC_BYTES);
      this.next('descriptor', 1);
    } else if (magic - (magic % 16) === SKIPPABLE_MAGIC) {
      this.next('skippableSize', 4);
    } else {
      throw malformed('a frame has an unknown magic number');
    }
  }

  readDescriptor(descriptor: number): void {
    if ((descriptor & 0x08) !== 0) {
      throw malformed('a frame descriptor has its reserved bit set');
    }
    const singleSegment = (descriptor & 0x20) !== 0;
    this.checksum = (descriptor & 0x04) !== 0;
    const windowDescriptor = singleSegment ? 0 : 1;
    this.next(
      'header',
      windowDescriptor +
        dictionaryIdBytes(descriptor & 0x03) +
        contentSizeBytes(descriptor >> 6, singleSegment),
    );
  }

  readBlockHeader(field: readonly number[]): void {
    const header = littleEndian(field);
    const type = (header >> 1) & 0x03;
    const size = header >>> 3;
    if (type === RESERVED_BLOCK) {
      throw malformed('a block has the reserved block type');
    }
    if (size > MAX_BLOCK_BYTES) {
      throw malformed('a block larger than 128 KB');
    }
    this.lastBlock = (header & 0x01) !== 0;
    this.next('blockContent', type === RLE_BLOCK ? 1 : size);
  }

  endBlock(): void {
    if (!this.lastBlock) this.next('blockHeader', 3);
    else this.next('checksum', this.checksum ? 4 : 0);
  }

  endFrame(): void {
    if (this.inFrame) this.out.push({ kind: 'end' });
    this.inFrame = false;
    this.next('magic', 4);
  }
}

const STEPS: Readonly<
  Record<Step, (splitter: FrameSplitter, field: readonly number[]) => void>
> = {
  magic: (splitter, field) => {
    splitter.readMagic(field);
  },
  skippableSize: (splitter, field) => {
    splitter.next('skippablePayload', littleEndian(field));
  },
  skippablePayload: (splitter) => {
    splitter.endFrame();
  },
  descriptor: (splitter, field) => {
    splitter.readDescriptor(littleEndian(field));
  },
  header: (splitter) => {
    splitter.next('blockHeader', 3);
  },
  blockHeader: (splitter, field) => {
    splitter.readBlockHeader(field);
  },
  blockContent: (splitter) => {
    splitter.endBlock();
  },
  checksum: (splitter) => {
    splitter.endFrame();
  },
};

/** The segments of `chunks`, read one by one on demand. */
class SegmentSource {
  private readonly splitter: FrameSplitter;
  private readonly chunks: AsyncIterator<Uint8Array>;
  private pending: Iterator<Segment, undefined> = [][Symbol.iterator]();

  constructor(chunks: AsyncIterator<Uint8Array>, maxFrames: number) {
    this.chunks = chunks;
    this.splitter = new FrameSplitter(maxFrames);
  }

  /**
   * The next segment: `done` once the stream ended between frames; fails
   * when it ended inside one.
   */
  async next(): Promise<Segment> {
    let segment = this.pending.next();
    while (segment.done === true) {
      const chunk = await this.chunks.next();
      this.pending = (
        chunk.done === true
          ? [this.splitter.finish()]
          : this.splitter.push(chunk.value)
      )[Symbol.iterator]();
      segment = this.pending.next();
    }
    return segment.value;
  }

  /**
   * Ends the chunks early, so their source can free what it holds. Not
   * awaited: a return queues behind a read waiting on the network, and the
   * failure that stopped reading must reach the reader at once (the body is
   * cancelled when the dump closes, which ends that read).
   */
  stop(): void {
    this.chunks.return?.().catch(() => undefined);
  }
}

/**
 * The zstd frames of `chunks`, each as its own stream of bytes, skippable
 * frames left out; read each frame to its end before asking for the next.
 * Fails on bytes that are not a well-formed sequence of frames, including
 * a stream cut inside a frame, and past `maxFrames` frames, skippable ones
 * included.
 */
export async function* zstdFrames(
  chunks: AsyncIterable<Uint8Array>,
  maxFrames: number,
): AsyncGenerator<AsyncGenerator<Uint8Array>> {
  const source = new SegmentSource(chunks[Symbol.asyncIterator](), maxFrames);
  try {
    for (;;) {
      const first = await source.next();
      if (first.kind === 'done') return;
      const frame = new FrameReader(source, first);
      yield frame.bytes();
      if (!frame.ended) throw new Error('a zstd frame was not read to its end');
    }
  } finally {
    source.stop();
  }
}

/** One frame's bytes, read from the shared segment source. */
class FrameReader {
  ended = false;
  private readonly source: SegmentSource;
  private readonly first: Segment;

  constructor(source: SegmentSource, first: Segment) {
    this.source = source;
    this.first = first;
  }

  /**
   * The frame's bytes up to its `end` segment. The stream cannot be `done`
   * inside a frame: the source fails there instead.
   */
  async *bytes(): AsyncGenerator<Uint8Array> {
    let segment = this.first;
    while (segment.kind === 'bytes') {
      yield segment.bytes;
      segment = await this.source.next();
    }
    this.ended = true;
  }
}
