import { describe, expect, it } from 'vitest';
import { markKey, parseMarks } from './marks';
import { growth, LINEAR_GROWTH } from './test-support';

describe('parseMarks', () => {
  it('reads arrows and circles and returns the rest of the comment', () => {
    expect(parseMarks('Main idea [%cal Ge2e4,Rd7d5] [%csl Yd4] here')).toEqual({
      text: 'Main idea here',
      arrows: [
        { from: 'e2', to: 'e4', color: 'G' },
        { from: 'd7', to: 'd5', color: 'R' },
      ],
      circles: [{ square: 'd4', color: 'Y' }],
    });
  });

  it('reads blue marks, several commands and spaces after commas', () => {
    expect(parseMarks('[%csl Ba1, Gh8][%cal Bb1c3]')).toEqual({
      text: '',
      arrows: [{ from: 'b1', to: 'c3', color: 'B' }],
      circles: [
        { square: 'a1', color: 'B' },
        { square: 'h8', color: 'G' },
      ],
    });
  });

  it('reads an arrow from a square to itself as a circle there', () => {
    expect(parseMarks('[%cal Ge4e4,Rg1f3] [%csl Yd4]')).toEqual({
      text: '',
      arrows: [{ from: 'g1', to: 'f3', color: 'R' }],
      circles: [
        { square: 'd4', color: 'Y' },
        { square: 'e4', color: 'G' },
      ],
    });
  });

  it('drops other commands such as clocks', () => {
    expect(parseMarks('[%clk 0:03:00] ok')).toEqual({
      text: 'ok',
      arrows: [],
      circles: [],
    });
  });

  it('keeps words apart when a command between them is removed', () => {
    expect(parseMarks('before[%clk 0:05:00]after').text).toBe('before after');
  });

  it('collapses whitespace, including line breaks', () => {
    expect(parseMarks('  best\n  by   test ').text).toBe('best by test');
  });

  it('reads the closed command after an unclosed one', () => {
    expect(parseMarks('[%cal [%cal Ge2e4]').arrows).toEqual([
      { from: 'e2', to: 'e4', color: 'G' },
    ]);
  });

  it('reads unclosed commands in linear time', () => {
    const comment = (bytes: number) => '[%cal '.repeat(Math.floor(bytes / 6));
    expect(parseMarks(comment(2 * 1024 * 1024)).arrows).toEqual([]);
    expect(growth(comment, parseMarks, 256 * 1024)).toBeLessThan(LINEAR_GROWTH);
  }, 300_000);

  it('ignores malformed entries', () => {
    expect(parseMarks('[%cal Xe2e4,Ge2] [%csl Gz9]')).toEqual({
      text: '',
      arrows: [],
      circles: [],
    });
  });
});

describe('markKey', () => {
  it('tells marks apart by kind, colour and squares', () => {
    const keys = [
      markKey({ from: 'e2', to: 'e4', color: 'G' }),
      markKey({ from: 'e2', to: 'e4', color: 'R' }),
      markKey({ from: 'e4', to: 'e2', color: 'G' }),
      markKey({ square: 'e2', color: 'G' }),
      markKey({ square: 'e4', color: 'G' }),
      markKey({ square: 'e2', color: 'R' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives the same mark the same key', () => {
    expect(markKey({ from: 'g1', to: 'f3', color: 'B' })).toBe(
      markKey({ color: 'B', to: 'f3', from: 'g1' }),
    );
    expect(markKey({ square: 'd5', color: 'Y' })).toBe(
      markKey({ color: 'Y', square: 'd5' }),
    );
  });
});

describe('parseMarks: malformed entries', () => {
  it('skips an entry with anything before or after its squares', () => {
    expect(parseMarks('[%cal Ge2e4x,xGe2e4] [%csl Gd4x,xGd4]')).toMatchObject({
      arrows: [],
      circles: [],
    });
  });
});
