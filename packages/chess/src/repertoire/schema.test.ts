import { describe, expect, it } from 'vitest';
import type { Arrow, ChapterNameSource, Circle, Side } from './graph';
import {
  arrowSchema,
  chapterNameSourceSchema,
  circleSchema,
  marksInputSchema,
  sideSchema,
  SIDES,
} from './schema';

const ok =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    schema.safeParse(value).success;

describe('repertoire schemas', () => {
  it('reads the two sides', () => {
    expect(SIDES).toEqual(['white', 'black']);
    const side: Side = sideSchema.parse('black');
    expect(side).toBe('black');
    expect(ok(sideSchema)('both')).toBe(false);
  });

  it.each([
    [{ kind: 'custom', name: 'Mano' }],
    [{ kind: 'eco', eco: 'B33' }],
    [{ kind: 'header', name: 'Sveshnikov' }],
    [{ kind: 'index', number: 1 }],
  ])('accepts the chapter name source %j', (source) => {
    const parsed: ChapterNameSource = chapterNameSourceSchema.parse(source);
    expect(parsed).toEqual(source);
  });

  it.each([
    [{ kind: 'index', number: 0 }],
    [{ kind: 'index', number: 1.5 }],
    [{ kind: 'eco', name: 'B33' }],
    [{ kind: 'other', name: 'x' }],
  ])('refuses the chapter name source %j', (source) => {
    expect(ok(chapterNameSourceSchema)(source)).toBe(false);
  });

  it('reads an arrow and a circle on real squares in a mark colour', () => {
    const arrow = { from: 'e2', to: 'e4', color: 'G' };
    const parsed: Arrow = arrowSchema.parse(arrow);
    expect(parsed).toEqual(arrow);
    const circle: Circle = circleSchema.parse({ square: 'h8', color: 'B' });
    expect(circle).toEqual({
      square: 'h8',
      color: 'B',
    });
  });

  it.each([
    [{ from: 'i9', to: 'e4', color: 'G' }],
    [{ from: 'e2', to: 'e4', color: 'X' }],
    [{ from: 'e2x', to: 'e4', color: 'G' }],
    [{ from: 'e2', to: 'xe4', color: 'R' }],
  ])('refuses the arrow %j', (arrow) => {
    expect(ok(arrowSchema)(arrow)).toBe(false);
  });

  it('refuses a circle off the board', () => {
    expect(ok(circleSchema)({ square: 'a0', color: 'Y' })).toBe(false);
  });

  it('allows up to 64 arrows and 64 circles on a move', () => {
    const arrows = Array.from({ length: 64 }, () => ({
      from: 'a1',
      to: 'a2',
      color: 'G',
    }));
    const circles = Array.from({ length: 64 }, () => ({
      square: 'a1',
      color: 'R',
    }));
    expect(ok(marksInputSchema)({ arrows, circles })).toBe(true);
    expect(
      ok(marksInputSchema)({ arrows: [...arrows, arrows[0]], circles }),
    ).toBe(false);
    expect(
      ok(marksInputSchema)({ arrows, circles: [...circles, circles[0]] }),
    ).toBe(false);
  });
});
