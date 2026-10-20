import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import type { Arrow, ChapterNameSource, Circle, Side } from './graph';
import {
  arrowSchema,
  chapterNameSourceSchema,
  circleSchema,
  marksInputSchema,
  repertoireGraphSchema,
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

describe('repertoireGraphSchema', () => {
  const imported = importPgn(
    '[Event "A"]\n\n1. e4 {Main} e5 2. Nf3 { [%cal Gg1f3] [%csl Re4] } *',
    'white',
  );
  if (!imported.ok) throw new Error(imported.refusal.reason);
  const g = imported.value.graph;
  const chapter = g.chapters[0];
  const move = g.moves[0];

  it('parses a graph importPgn made, stored as JSON', () => {
    expect(g.moves.some((m) => m.arrows.length > 0)).toBe(true);
    expect(repertoireGraphSchema.parse(JSON.parse(JSON.stringify(g)))).toEqual(
      g,
    );
  });

  it.each([
    ['a bad side', { ...g, side: 'red' }],
    [
      'a chapter without a root',
      { ...g, chapters: [{ ...chapter, rootKey: '' }] },
    ],
    ['a chapter without an id', { ...g, chapters: [{ ...chapter, id: '' }] }],
    [
      'a chapter with a bad name source',
      { ...g, chapters: [{ ...chapter, nameSource: { kind: 'x' } }] },
    ],
    ['a move without a from key', { ...g, moves: [{ ...move, from: '' }] }],
    ['a move without a to key', { ...g, moves: [{ ...move, to: '' }] }],
    ['a move without a SAN', { ...g, moves: [{ ...move, san: '' }] }],
    ['a move without a UCI', { ...g, moves: [{ ...move, uci: '' }] }],
    [
      'a move with a bad arrow',
      {
        ...g,
        moves: [{ ...move, arrows: [{ from: 'z9', to: 'e4', color: 'G' }] }],
      },
    ],
    [
      'a move with a bad circle',
      { ...g, moves: [{ ...move, circles: [{ square: 'e4', color: 'X' }] }] },
    ],
    [
      'a move with a numeric comment',
      { ...g, moves: [{ ...move, comment: 1 }] },
    ],
    [
      'a move with an empty chapter id',
      { ...g, moves: [{ ...move, chapters: [''] }] },
    ],
    ['no moves list', { side: g.side, chapters: g.chapters }],
  ])('refuses %s', (_name, value) => {
    expect(ok(repertoireGraphSchema)(value)).toBe(false);
  });
});
