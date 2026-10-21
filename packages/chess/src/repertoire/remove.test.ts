import { describe, expect, it } from 'vitest';
import { START_KEY } from '../position-key';
import type { Result } from '../result';
import { addMove } from './edit';
import type { Chapter, RepertoireGraph } from './graph';
import { removalCount, withoutMove } from './remove';

const C1: Chapter = {
  id: 'c1',
  rootKey: START_KEY,
  intro: null,
  nameSource: { kind: 'index', number: 1 },
};

function must(r: Result<RepertoireGraph, { reason: string }>) {
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

/** One chapter: 1.d4 d5 2.Bf4 Nf6 3.e3, with 2...c5 3.c3 beside it. */
function london(): RepertoireGraph {
  let g: RepertoireGraph = { side: 'white', chapters: [C1], moves: [] };
  const line = (sans: string[]) => {
    let key = START_KEY;
    for (const san of sans) {
      g = must(addMove(g, 'c1', key, san));
      key = g.moves.find((m) => m.from === key && m.san === san)?.to ?? key;
    }
  };
  line(['d4', 'd5', 'Bf4', 'Nf6', 'e3']);
  line(['d4', 'd5', 'Bf4', 'c5', 'c3']);
  return g;
}

const fromOf = (g: RepertoireGraph, san: string): string =>
  g.moves.find((m) => m.san === san)?.from ?? '';

describe('withoutMove', () => {
  it('takes the move and every move only it reached, keeping the name', () => {
    // Still "Chapter 1", so a rename to the moves' opening would show.
    const g = { ...london(), chapters: [C1] };
    const after = withoutMove(g, C1, fromOf(g, 'Bf4'), 'Bf4');
    expect(after.moves.map((m) => m.san)).toEqual(['d4', 'd5']);
    expect(after.chapters).toStrictEqual([
      {
        id: 'c1',
        rootKey: START_KEY,
        intro: null,
        nameSource: { kind: 'index', number: 1 },
      },
    ]);
  });

  it('keeps a move another chapter uses, without this chapter', () => {
    const g = london();
    const shared: RepertoireGraph = {
      ...g,
      moves: g.moves.map((m) =>
        m.san === 'e3' ? { ...m, chapters: ['c1', 'c2'] } : m,
      ),
    };
    const after = withoutMove(shared, C1, fromOf(g, 'Nf6'), 'Nf6');
    expect(after.moves.find((m) => m.san === 'e3')?.chapters).toEqual(['c2']);
    expect(after.moves.some((m) => m.san === 'Nf6')).toBe(false);
  });
});

describe('removalCount', () => {
  it('counts the chapter’s moves after the move that go with it', () => {
    const g = london();
    expect(removalCount(g, 'c1', fromOf(g, 'Bf4'), 'Bf4')).toBe(4);
    expect(removalCount(g, 'c1', START_KEY, 'd4')).toBe(6);
  });

  it('counts nothing after a line’s last move, an unknown move or chapter', () => {
    const g = london();
    expect(removalCount(g, 'c1', fromOf(g, 'e3'), 'e3')).toBe(0);
    expect(removalCount(g, 'c1', START_KEY, 'e4')).toBe(0);
    expect(removalCount(g, 'c9', START_KEY, 'd4')).toBe(0);
  });
});
