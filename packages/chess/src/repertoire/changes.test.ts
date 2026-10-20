import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import type { Result } from '../result';
import { graphChanges, netMoveChanges, playerMoveChanges } from './changes';
import {
  addMove,
  editComment,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
  type EditRefusal,
} from './edit';
import { moveKey, splitMoveKey, type RepertoireGraph } from './graph';

function graphOf(text: string): RepertoireGraph {
  const r = importPgn(text, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
function ok(r: Result<RepertoireGraph, EditRefusal>): RepertoireGraph {
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const base = graphOf(
  '[Event "A"]\n\n1. e4 e5 2. Nf3 *\n\n[Event "B"]\n\n1. e4 c5 *',
);
const START = base.chapters[0]?.rootKey ?? '';
const keyOf = (san: string) => {
  const m = base.moves.find((x) => x.san === san);
  if (m === undefined) throw new Error(san);
  return moveKey(m.from, m.san);
};
const toOf = (graph: RepertoireGraph, san: string) =>
  graph.moves.find((m) => m.san === san)?.to ?? '';

const EMPTY = {
  addedChapters: [],
  removedChapterIds: [],
  changedChapters: [],
  addedMoves: [],
  removedMoveKeys: [],
  annotatedMoves: [],
  addedLinks: [],
  removedLinks: [],
};

describe('graphChanges', () => {
  it('finds nothing between a graph and itself', () => {
    expect(graphChanges(base, base)).toEqual(EMPTY);
  });

  it('finds an added move with its chapters, and the chapter its moves renamed', () => {
    const after = ok(addMove(base, 'c1', toOf(base, 'Nf3'), 'Nc6'));
    const d = graphChanges(base, after);
    expect(d.addedMoves.map((m) => [m.san, m.chapters])).toEqual([
      ['Nc6', ['c1']],
    ]);
    // R-104: an ECO-named chapter follows its moves (C40 -> C44).
    expect(d.changedChapters.map((c) => [c.id, c.nameSource])).toEqual([
      ['c1', { kind: 'eco', eco: 'C44' }],
    ]);
    expect({ ...d, addedMoves: [], changedChapters: [] }).toEqual(EMPTY);
  });

  it('finds a changed comment and changed marks as annotations, nothing else', () => {
    let after = ok(editComment(base, keyOf('e4'), 'Best'));
    after = ok(
      setMarks(
        after,
        'c1',
        { from: START, san: 'e4' },
        { arrows: [{ from: 'g1', to: 'f3', color: 'G' }], circles: [] },
      ),
    );
    const d = graphChanges(base, after);
    expect(
      d.annotatedMoves.map((m) => [m.san, m.comment, m.arrows.length]),
    ).toEqual([['e4', 'Best', 1]]);
    expect({ ...d, annotatedMoves: [] }).toEqual(EMPTY);
  });

  it('finds changed circles alone as an annotation', () => {
    const after = ok(
      setMarks(
        base,
        'c1',
        { from: START, san: 'e4' },
        { arrows: [], circles: [{ square: 'e4', color: 'R' }] },
      ),
    );
    expect(graphChanges(base, after).annotatedMoves.map((m) => m.san)).toEqual([
      'e4',
    ]);
  });

  it('finds a removed move, and a link removed from a move another chapter keeps', () => {
    const after = ok(removeMove(base, 'c2', START, 'e4'));
    const d = graphChanges(base, after);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c2' }]);
  });

  it('finds a removed chapter without listing the links its removal cascades', () => {
    const d = graphChanges(base, ok(removeChapter(base, 'c2')));
    expect(d.removedChapterIds).toEqual(['c2']);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([]);
  });

  it('finds a renamed chapter', () => {
    const d = graphChanges(base, ok(renameChapter(base, 'c1', 'Open')));
    expect(d.changedChapters.map((c) => c.nameSource)).toEqual([
      { kind: 'custom', name: 'Open' },
    ]);
  });

  it('finds a chapter whose intro alone changed', () => {
    const after = {
      ...base,
      chapters: base.chapters.map((c) =>
        c.id === 'c2' ? { ...c, intro: 'Sicilian' } : c,
      ),
    };
    expect(graphChanges(base, after).changedChapters.map((c) => c.id)).toEqual([
      'c2',
    ]);
  });

  it('finds a link added to an existing move', () => {
    const withC3 = {
      ...base,
      chapters: [
        ...base.chapters,
        {
          id: 'c3',
          rootKey: START,
          intro: null,
          nameSource: { kind: 'index', number: 3 } as const,
        },
      ],
    };
    const after = ok(addMove(withC3, 'c3', START, 'e4'));
    const d = graphChanges(withC3, after);
    expect(d.addedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c3' }]);
    expect(d.addedChapters).toEqual([]);
  });

  it('finds an added chapter', () => {
    const c3 = {
      id: 'c3',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', number: 3 } as const,
    };
    const after = { ...base, chapters: [...base.chapters, c3] };
    expect(graphChanges(base, after)).toEqual({
      ...EMPTY,
      addedChapters: [c3],
    });
  });
});

describe('playerMoveChanges', () => {
  it('lists added and removed player moves with their chapters, and counts annotations', () => {
    let after = ok(addMove(base, 'c1', toOf(base, 'Nf3'), 'Nc6'));
    after = ok(addMove(after, 'c1', toOf(after, 'Nc6'), 'Bb5'));
    after = ok(removeMove(after, 'c2', START, 'e4'));
    after = ok(editComment(after, keyOf('e5'), 'Main'));
    const c = playerMoveChanges(base, after);
    // White's repertoire: Bb5 is a player move, Nc6 is not.
    expect(
      c.added.map((l) => [splitMoveKey(l.moveKey).san, l.chapterId]),
    ).toEqual([['Bb5', 'c1']]);
    expect(c.removed).toEqual([]); // e4 stays: chapter c1 still holds it
    expect(c.annotated).toBe(1);
  });

  it('lists a removed player move once per chapter it was in', () => {
    const after = ok(removeMove(base, 'c1', toOf(base, 'e5'), 'Nf3'));
    expect(playerMoveChanges(base, after).removed).toEqual([
      { moveKey: keyOf('Nf3'), chapterId: 'c1' },
    ]);
  });

  it('lists a player move removed from two chapters under both', () => {
    const after = ok(removeChapter(ok(removeChapter(base, 'c2')), 'c1'));
    expect(playerMoveChanges(base, after).removed).toEqual([
      { moveKey: keyOf('e4'), chapterId: 'c1' },
      { moveKey: keyOf('e4'), chapterId: 'c2' },
      { moveKey: keyOf('Nf3'), chapterId: 'c1' },
    ]);
  });

  it('lists the moves of a black repertoire from Black', () => {
    const black = importPgn('1. e4 c5 2. Nf3 *', 'black');
    if (!black.ok) throw new Error(black.refusal.reason);
    const g = black.value.graph;
    const after = ok(addMove(g, 'c1', toOf(g, 'Nf3'), 'd6'));
    const c5 = g.moves.find((m) => m.san === 'c5');
    expect(playerMoveChanges(g, after).added.map((l) => l.moveKey)).toEqual([
      moveKey(toOf(g, 'Nf3'), 'd6'),
    ]);
    const without = ok(removeMove(g, 'c1', toOf(g, 'e4'), 'c5'));
    expect(playerMoveChanges(g, without).removed).toEqual([
      { moveKey: moveKey(c5?.from ?? '', 'c5'), chapterId: 'c1' },
    ]);
  });

  it('is empty between a graph and itself', () => {
    expect(playerMoveChanges(base, base)).toEqual({
      added: [],
      removed: [],
      annotated: 0,
    });
  });
});

describe('netMoveChanges', () => {
  const link = (moveKey: string, chapterId = 'c1') => ({ moveKey, chapterId });

  it('drops a move added and then removed, and a move removed and then added back', () => {
    expect(
      netMoveChanges([
        { added: [link('a')], removed: [link('b')], annotated: 1 },
        { added: [link('b'), link('c')], removed: [link('a')], annotated: 2 },
      ]),
    ).toEqual({ added: [link('c')], removed: [], annotated: 3 });
  });

  it('keeps every chapter link of a move, from its last step', () => {
    expect(
      netMoveChanges([
        {
          added: [link('a', 'c1'), link('a', 'c2')],
          removed: [],
          annotated: 0,
        },
      ]),
    ).toEqual({
      added: [link('a', 'c1'), link('a', 'c2')],
      removed: [],
      annotated: 0,
    });
  });

  it('keeps a move removed in a later step', () => {
    expect(
      netMoveChanges([
        { added: [link('a')], removed: [], annotated: 0 },
        { added: [], removed: [link('b', 'c2')], annotated: 0 },
      ]),
    ).toEqual({ added: [link('a')], removed: [link('b', 'c2')], annotated: 0 });
  });

  it('is empty for no steps', () => {
    expect(netMoveChanges([])).toEqual({
      added: [],
      removed: [],
      annotated: 0,
    });
  });
});
