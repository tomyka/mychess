import {
  addMove,
  editComment,
  importPgn,
  moveKey,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
  type RepertoireGraph,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { diffRepertoire } from '../src/repertoires/diff';

function graphOf(text: string): RepertoireGraph {
  const r = importPgn(text, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
function ok(
  r:
    | { ok: true; value: RepertoireGraph }
    | { ok: false; refusal: { reason: string } },
): RepertoireGraph {
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

const EMPTY = {
  addedChapters: [],
  removedChapterIds: [],
  changedChapters: [],
  addedMoves: [],
  removedMoveKeys: [],
  changedMoves: [],
  addedLinks: [],
  removedLinks: [],
};

describe('diffRepertoire', () => {
  it('finds nothing between a graph and itself', () => {
    expect(diffRepertoire(base, base)).toEqual(EMPTY);
  });

  it('finds an added move with its chapters, and the chapter its moves renamed', () => {
    const nf3 = base.moves.find((m) => m.san === 'Nf3');
    const after = ok(addMove(base, 'c1', nf3?.to ?? '', 'Nc6'));
    const d = diffRepertoire(base, after);
    expect(d.addedMoves.map((m) => [m.san, m.chapters])).toEqual([
      ['Nc6', ['c1']],
    ]);
    // R-104: an ECO-named chapter follows its moves (C40 -> C44).
    expect(d.changedChapters.map((c) => [c.id, c.nameSource])).toEqual([
      ['c1', { kind: 'eco', eco: 'C44' }],
    ]);
    expect({ ...d, addedMoves: [], changedChapters: [] }).toEqual(EMPTY);
  });

  it('finds a changed comment and changed marks, nothing else', () => {
    let after = ok(editComment(base, keyOf('e4'), 'Best'));
    after = ok(
      setMarks(
        after,
        'c1',
        { from: START, san: 'e4' },
        { arrows: [{ from: 'g1', to: 'f3', color: 'G' }], circles: [] },
      ),
    );
    const d = diffRepertoire(base, after);
    expect(
      d.changedMoves.map((m) => [m.san, m.comment, m.arrows.length]),
    ).toEqual([['e4', 'Best', 1]]);
    expect({ ...d, changedMoves: [] }).toEqual(EMPTY);
  });

  it('finds a removed move, and a link removed from a move another chapter keeps', () => {
    const after = ok(removeMove(base, 'c2', START, 'e4'));
    const d = diffRepertoire(base, after);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c2' }]);
  });

  it('finds a removed chapter without listing the links its removal cascades', () => {
    const d = diffRepertoire(base, ok(removeChapter(base, 'c2')));
    expect(d.removedChapterIds).toEqual(['c2']);
    expect(d.removedMoveKeys).toEqual([keyOf('c5')]);
    expect(d.removedLinks).toEqual([]);
  });

  it('finds a renamed chapter', () => {
    const d = diffRepertoire(base, ok(renameChapter(base, 'c1', 'Open')));
    expect(d.changedChapters.map((c) => c.nameSource)).toEqual([
      { kind: 'custom', name: 'Open' },
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
    const d = diffRepertoire(withC3, after);
    expect(d.addedLinks).toEqual([{ moveKey: keyOf('e4'), chapterId: 'c3' }]);
  });
});
