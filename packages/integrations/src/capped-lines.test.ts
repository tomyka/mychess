import { describe, expect, it } from 'vitest';
import { cappedLines } from './capped-lines';
import { collectAll, textChunks } from './test-support';

describe('cappedLines', () => {
  it('splits text into lines across chunk boundaries', async () => {
    const lines = await collectAll(
      cappedLines(textChunks('[A "1"]\n[B "2"]\n\n1. e4 *\n', 3), 100),
    );
    expect(lines).toEqual([
      { text: '[A "1"]', truncated: false },
      { text: '[B "2"]', truncated: false },
      { text: '', truncated: false },
      { text: '1. e4 *', truncated: false },
    ]);
  });

  it('drops the carriage return of a CRLF line end', async () => {
    const lines = await collectAll(
      cappedLines(textChunks('a\r\nb\r\n', 2), 10),
    );
    expect(lines.map((line) => line.text)).toEqual(['a', 'b']);
  });

  it('yields a last line without a line end', async () => {
    const lines = await collectAll(cappedLines(textChunks('a\nlast', 4), 10));
    expect(lines.map((line) => line.text)).toEqual(['a', 'last']);
  });

  it('keeps only the first characters of a long line and marks it truncated', async () => {
    const long = 'x'.repeat(5000);
    const lines = await collectAll(
      cappedLines(textChunks(`${long}\nok\n`, 333), 10),
    );
    expect(lines).toEqual([
      { text: 'x'.repeat(10), truncated: true },
      { text: 'ok', truncated: false },
    ]);
  });

  it('keeps a line of exactly the cap whole', async () => {
    const lines = await collectAll(cappedLines(textChunks('abcd\n', 1), 4));
    expect(lines).toEqual([{ text: 'abcd', truncated: false }]);
  });

  it('keeps a CRLF line of exactly the cap whole', async () => {
    const lines = await collectAll(
      cappedLines(textChunks('abcd\r\nabcde\r\n', 1), 4),
    );
    expect(lines).toEqual([
      { text: 'abcd', truncated: false },
      { text: 'abcd', truncated: true },
    ]);
  });

  it('yields nothing for empty text', async () => {
    await expect(
      collectAll(cappedLines(textChunks('', 1), 4)),
    ).resolves.toEqual([]);
  });
});
