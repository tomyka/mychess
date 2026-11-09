/** A line of text, cut to a cap. */
export interface CappedLine {
  /** The line without its line end, at most the cap's characters. */
  readonly text: string;
  /** Whether the line was longer than the cap and lost its tail. */
  readonly truncated: boolean;
}

/**
 * The lines of a text stream, read on demand. A line longer than
 * `maxLength` keeps only its first `maxLength` characters and is marked
 * truncated; the rest is skipped as it streams, never collected, so a long
 * move-text line costs no memory.
 */
export async function* cappedLines(
  chunks: AsyncIterable<string>,
  maxLength: number,
): AsyncGenerator<CappedLine> {
  const line = new LineBuffer(maxLength);
  for await (const chunk of chunks) {
    yield* line.feed(chunk);
  }
  if (!line.isEmpty()) yield line.take();
}

class LineBuffer {
  private readonly maxLength: number;
  private text = '';
  private truncated = false;

  constructor(maxLength: number) {
    this.maxLength = maxLength;
  }

  *feed(chunk: string): Generator<CappedLine> {
    let start = 0;
    let end = chunk.indexOf('\n');
    while (end !== -1) {
      this.append(chunk, start, end);
      yield this.take();
      start = end + 1;
      end = chunk.indexOf('\n', start);
    }
    this.append(chunk, start, chunk.length);
  }

  isEmpty(): boolean {
    return this.text === '' && !this.truncated;
  }

  take(): CappedLine {
    // One character more than the cap is kept, so a line of exactly the
    // cap followed by `\r` is not taken for a longer one.
    const text = this.text.endsWith('\r') ? this.text.slice(0, -1) : this.text;
    const line = {
      text: text.slice(0, this.maxLength),
      truncated: this.truncated || text.length > this.maxLength,
    };
    this.text = '';
    this.truncated = false;
    return line;
  }

  private append(chunk: string, start: number, end: number): void {
    const room = this.maxLength + 1 - this.text.length;
    if (end - start > room) this.truncated = true;
    this.text += chunk.slice(start, start + Math.min(room, end - start));
  }
}
