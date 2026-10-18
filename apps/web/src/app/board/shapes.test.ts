import type { Marks } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { marksOf, shapesOf, toggleMark } from './shapes';

const NONE: Marks = { arrows: [], circles: [] };

describe('shapesOf', () => {
  it('turns arrows and circles into chessground shapes, arrows first', () => {
    expect(
      shapesOf({
        arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
        circles: [{ square: 'd4', color: 'R' }],
      }),
    ).toEqual([
      { orig: 'g1', dest: 'f3', brush: 'green' },
      { orig: 'd4', brush: 'red' },
    ]);
  });

  it('maps every mark colour to its brush', () => {
    expect(
      shapesOf({
        arrows: [],
        circles: [
          { square: 'a1', color: 'Y' },
          { square: 'a2', color: 'B' },
        ],
      }),
    ).toEqual([
      { orig: 'a1', brush: 'yellow' },
      { orig: 'a2', brush: 'blue' },
    ]);
  });

  it('skips a mark on a square that is not on the board', () => {
    expect(
      shapesOf({
        arrows: [
          { from: 'z9', to: 'f3', color: 'G' },
          { from: 'g1', to: 'z9', color: 'G' },
        ],
        circles: [{ square: 'z9', color: 'R' }],
      }),
    ).toEqual([]);
  });
});

describe('marksOf', () => {
  it('reverses shapesOf', () => {
    const marks: Marks = {
      arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
      circles: [
        { square: 'd4', color: 'R' },
        { square: 'e5', color: 'Y' },
      ],
    };
    expect(marksOf(shapesOf(marks))).toEqual(marks);
  });

  it('reads a shape that starts and ends on one square as a circle', () => {
    expect(marksOf([{ orig: 'e4', dest: 'e4', brush: 'blue' }])).toEqual({
      arrows: [],
      circles: [{ square: 'e4', color: 'B' }],
    });
  });

  it('skips a brush that is not one of the four mark colours', () => {
    expect(
      marksOf([{ orig: 'e4', dest: 'e5', brush: 'paleBlue' }, { orig: 'e4' }]),
    ).toEqual(NONE);
  });
});

describe('toggleMark', () => {
  const arrow: Marks = {
    arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
    circles: [],
  };

  it('adds an arrow between two squares', () => {
    expect(toggleMark(NONE, 'g1', 'f3', 'G')).toEqual(arrow);
  });

  it('removes the same arrow in the same colour', () => {
    expect(toggleMark(arrow, 'g1', 'f3', 'G')).toEqual(NONE);
  });

  it('recolours the same arrow in another colour', () => {
    expect(toggleMark(arrow, 'g1', 'f3', 'B')).toEqual({
      arrows: [{ from: 'g1', to: 'f3', color: 'B' }],
      circles: [],
    });
  });

  it('keeps an arrow the other way round apart', () => {
    expect(toggleMark(arrow, 'f3', 'g1', 'G').arrows).toEqual([
      { from: 'g1', to: 'f3', color: 'G' },
      { from: 'f3', to: 'g1', color: 'G' },
    ]);
  });

  it('toggles a circle on the same square twice and leaves the arrows', () => {
    const circled = toggleMark(arrow, 'd4', 'd4', 'Y');
    expect(circled).toEqual({
      arrows: arrow.arrows,
      circles: [{ square: 'd4', color: 'Y' }],
    });
    expect(toggleMark(circled, 'd4', 'd4', 'Y')).toEqual(arrow);
    expect(toggleMark(circled, 'd4', 'd4', 'R').circles).toEqual([
      { square: 'd4', color: 'R' },
    ]);
  });

  it('leaves the circles on other squares', () => {
    const two = toggleMark(toggleMark(NONE, 'a1', 'a1', 'G'), 'b2', 'b2', 'G');
    expect(toggleMark(two, 'a1', 'a1', 'G').circles).toEqual([
      { square: 'b2', color: 'G' },
    ]);
  });
});
