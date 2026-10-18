import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import {
  addChapter,
  addMove,
  editComment,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
} from './edit';
import { moveKey, type Chapter, type RepertoireGraph } from './graph';
import { lines } from './walk';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function mustAdd(
  r: Result<RepertoireGraph, { reason: string }>,
): RepertoireGraph {
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);
const chapter = (id: string, rootKey: string, number: number): Chapter => ({
  id,
  rootKey,
  intro: null,
  nameSource: { kind: 'index', number },
});
const C2 = chapter('c2', START, 2);
const empty: RepertoireGraph = {
  side: 'white',
  chapters: [chapter('c1', START, 1)],
  moves: [],
};

function build(...sans: string[]): RepertoireGraph {
  let g = empty;
  let key = START;
  for (const san of sans) {
    g = mustAdd(addMove(g, 'c1', key, san));
    key = g.moves.find((m) => m.from === key && m.san === san)?.to ?? key;
  }
  return g;
}

const withC2 = (g: RepertoireGraph): RepertoireGraph => ({
  ...g,
  chapters: [...g.chapters, C2],
});

const sansOf = (g: RepertoireGraph, chapterId: string) =>
  lines(g, chapterId).map((l) => l.map((m) => m.san));

const unknownChapter = {
  ok: false,
  refusal: { reason: 'repertoire.unknownChapter' },
};

describe('addMove', () => {
  it('adds a legal move with canonical SAN and UCI', () => {
    const g = build('e4');
    expect(g.moves).toEqual([
      expect.objectContaining({
        from: START,
        san: 'e4',
        uci: 'e2e4',
        chapters: ['c1'],
      }),
    ]);
  });

  it('stores canonical SAN for a move given in coordinate notation', () => {
    const g = mustAdd(addMove(empty, 'c1', START, 'e2e4'));
    expect(g.moves).toEqual([
      expect.objectContaining({ san: 'e4', uci: 'e2e4' }),
    ]);
  });

  it('refuses an illegal move', () => {
    expect(addMove(empty, 'c1', START, 'e5')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.illegalMove' },
    });
  });

  it('refuses an unknown chapter', () => {
    expect(addMove(empty, 'nope', START, 'e4')).toEqual(unknownChapter);
  });

  it('refuses a position the chapter does not reach', () => {
    const elsewhere = positionKey('8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(addMove(empty, 'c1', elsewhere, 'Kb1')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownPosition' },
    });
  });

  it('refuses a second answer for the player in one position', () => {
    const g = build('e4');
    expect(addMove(g, 'c1', START, 'd4')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.secondAnswer' },
    });
  });

  it('refuses a second answer from another chapter of the repertoire', () => {
    expect(addMove(withC2(build('e4')), 'c2', START, 'd4')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.secondAnswer' },
    });
  });

  it('allows several opponent moves in one position', () => {
    const g = build('e4', 'e5');
    const afterE4 = must(g.moves[0]).to;
    const r = addMove(g, 'c1', afterE4, 'c5');
    expect(
      r.ok && r.value.moves.filter((m) => m.from === afterE4),
    ).toHaveLength(2);
  });

  it('returns the graph itself when the chapter already has the move', () => {
    const g = build('e4', 'e5');
    for (const san of ['e4', 'e2e4']) {
      const r = addMove(g, 'c1', START, san);
      expect(r.ok && r.value).toBe(g);
    }
  });

  it('adds the chapter to an existing move instead of duplicating it', () => {
    const r = addMove(withC2(build('e4')), 'c2', START, 'e4');
    expect(r.ok && r.value.moves).toEqual([
      expect.objectContaining({ chapters: ['c1', 'c2'] }),
    ]);
  });

  it('stores the UCI of a promotion with its piece', () => {
    const root = positionKey('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
    const g: RepertoireGraph = { ...empty, chapters: [chapter('c1', root, 1)] };
    const r = addMove(g, 'c1', root, 'e8=Q+');
    expect(r.ok && r.value.moves).toEqual([
      expect.objectContaining({
        san: 'e8=Q+',
        uci: 'e7e8q',
        to: positionKey('k3Q3/8/8/8/8/8/8/K7 b - - 0 1'),
      }),
    ]);
  });

  it('ends a line with the move that repeats a position, not looping', () => {
    const g = build('Nf3', 'Nf6', 'Ng1', 'Ng8');
    expect(g.moves.at(-1)?.to).toBe(START);
    expect(sansOf(g, 'c1')).toEqual([['Nf3', 'Nf6', 'Ng1', 'Ng8']]);
  });
});

describe('removeMove', () => {
  it('removes the move and every move only it reached', () => {
    const g = mustAdd(removeMove(build('e4', 'e5', 'Nf3'), 'c1', START, 'e4'));
    expect(g.moves).toEqual([]);
  });

  it('keeps moves still reachable another way (transposition)', () => {
    // 1.d4 Nf6 2.c4 e6 3.Nc3 and 1.d4 e6 2.c4 Nf6 reach the same position.
    let g = build('d4', 'Nf6', 'c4', 'e6', 'Nc3');
    const afterD4 = must(g.moves[0]).to;
    g = mustAdd(addMove(g, 'c1', afterD4, 'e6'));
    const afterE6 = must(
      g.moves.find((m) => m.from === afterD4 && m.san === 'e6'),
    ).to;
    g = mustAdd(addMove(g, 'c1', afterE6, 'c4'));
    const afterC4 = must(
      g.moves.find((m) => m.from === afterE6 && m.san === 'c4'),
    ).to;
    g = mustAdd(addMove(g, 'c1', afterC4, 'Nf6'));
    // Removing 1...Nf6 must keep 3.Nc3: the 1...e6 order still reaches it.
    g = mustAdd(removeMove(g, 'c1', afterD4, 'Nf6'));
    expect(g.moves.some((m) => m.san === 'Nc3')).toBe(true);
    expect(g.moves.some((m) => m.san === 'Nf6' && m.from === afterD4)).toBe(
      false,
    );
    expect(sansOf(g, 'c1')).toEqual([['d4', 'e6', 'c4', 'Nf6', 'Nc3']]);
  });

  it('keeps a move another chapter still uses', () => {
    const g = mustAdd(addMove(withC2(build('e4', 'e5')), 'c2', START, 'e4'));
    const after = mustAdd(removeMove(g, 'c1', START, 'e4'));
    expect(after.moves).toEqual([
      expect.objectContaining({ san: 'e4', chapters: ['c2'] }),
    ]);
  });

  it('refuses an unknown chapter', () => {
    expect(removeMove(build('e4'), 'nope', START, 'e4')).toEqual(
      unknownChapter,
    );
  });
});

describe('setMarks', () => {
  const marks = {
    arrows: [{ from: 'e2', to: 'e4', color: 'G' }],
    circles: [{ square: 'd5', color: 'R' }],
  } as const;

  it('sets arrows and circles on a move', () => {
    const r = setMarks(build('e4'), 'c1', { from: START, san: 'e4' }, marks);
    expect(r.ok && r.value.moves[0]).toEqual(expect.objectContaining(marks));
  });

  it('leaves the marks of the other moves alone', () => {
    const r = setMarks(
      build('e4', 'e5'),
      'c1',
      { from: START, san: 'e4' },
      marks,
    );
    expect(r.ok && r.value.moves[1]).toEqual(
      expect.objectContaining({ san: 'e5', arrows: [], circles: [] }),
    );
  });

  it('refuses marks on a move that does not exist', () => {
    expect(
      setMarks(build('e4'), 'c1', { from: START, san: 'd4' }, marks),
    ).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownMove' },
    });
  });

  it('refuses marks on a move outside the chapter', () => {
    expect(
      setMarks(withC2(build('e4')), 'c2', { from: START, san: 'e4' }, marks),
    ).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownMove' },
    });
  });

  it('refuses an unknown chapter', () => {
    expect(
      setMarks(build('e4'), 'nope', { from: START, san: 'e4' }, marks),
    ).toEqual(unknownChapter);
  });
});

describe('editComment', () => {
  const g = build('e4', 'e5');
  const e4 = moveKey(START, 'e4');

  it('sets a move comment in the form PGN carries', () => {
    const edited = mustAdd(editComment(g, e4, '  Best\nby test '));
    expect(edited.moves.find((m) => m.san === 'e4')?.comment).toBe(
      'Best by test',
    );
    expect(edited.moves.find((m) => m.san === 'e5')).toBe(
      g.moves.find((m) => m.san === 'e5'),
    );
    expect(edited.chapters).toBe(g.chapters);
  });

  it('clears the comment with blank text', () => {
    const commented = mustAdd(editComment(g, e4, 'Best'));
    expect(commented.moves[0]?.comment).toBe('Best');
    expect(
      mustAdd(editComment(commented, e4, '  ')).moves[0]?.comment,
    ).toBeNull();
  });

  it('refuses a move the repertoire does not have', () => {
    expect(editComment(g, moveKey(START, 'd4'), 'x')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownMove' },
    });
  });
});

describe('removeChapter', () => {
  it('removes the chapter and the moves only it used', () => {
    let g = withC2(build('e4', 'e5', 'Nf3'));
    g = mustAdd(addMove(g, 'c2', START, 'e4'));
    const after = mustAdd(removeChapter(g, 'c1'));
    expect(after.side).toBe('white');
    expect(after.chapters.map((c) => c.id)).toEqual(['c2']);
    expect(after.moves.map((m) => [m.san, m.chapters])).toEqual([
      ['e4', ['c2']],
    ]);
  });

  it('keeps another chapter untouched', () => {
    const g = withC2(build('e4'));
    const after = mustAdd(removeChapter(g, 'c2'));
    expect(after.chapters.map((c) => c.id)).toEqual(['c1']);
    expect(after.moves).toEqual(g.moves);
  });

  it('refuses an unknown chapter', () => {
    expect(removeChapter(build('e4'), 'c9')).toEqual(unknownChapter);
  });
});

describe('addChapter', () => {
  it('adds an empty chapter from a position with the next free id and number', () => {
    const before = withC2(empty);
    const { graph, chapterId } = addChapter(before, START);
    expect(chapterId).toBe('c3');
    expect(graph.chapters.slice(0, 2)).toEqual(before.chapters);
    expect(graph.chapters.at(-1)).toEqual({
      id: 'c3',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', number: 3 },
    });
    expect(graph.moves).toBe(before.moves);
  });

  it('never repeats a number after a chapter was removed', () => {
    const g = mustAdd(removeChapter(withC2(empty), 'c1'));
    const added = addChapter(g, START);
    expect(added.chapterId).toBe('c3');
    expect(added.graph.chapters.at(-1)?.nameSource).toEqual({
      kind: 'index',
      number: 3,
    });
  });

  it('numbers past a custom-named chapter', () => {
    const g = mustAdd(renameChapter(empty, 'c1', 'Mano'));
    expect(addChapter(g, START).graph.chapters.at(-1)?.nameSource).toEqual({
      kind: 'index',
      number: 2,
    });
  });

  it('takes ids past any chapter id, ignoring ids of another form', () => {
    const odd = {
      ...empty,
      chapters: [chapter('c7', START, 1), chapter('x', START, 2)],
    };
    expect(addChapter(odd, START).chapterId).toBe('c8');
    expect(addChapter({ ...empty, chapters: [] }, START).chapterId).toBe('c1');
    const near = {
      ...empty,
      chapters: ['c12', 'xc40', 'c50x'].map((id, i) =>
        chapter(id, START, i + 1),
      ),
    };
    expect(addChapter(near, START).chapterId).toBe('c13');
  });
});

describe('renameChapter', () => {
  it('gives the chapter a custom name', () => {
    const g = mustAdd(renameChapter(withC2(empty), 'c1', 'Londono sistema'));
    expect(g.chapters[0]?.nameSource).toEqual({
      kind: 'custom',
      name: 'Londono sistema',
    });
    expect(g.chapters[1]).toBe(C2);
  });

  it('refuses an unknown chapter', () => {
    expect(renameChapter(empty, 'c9', 'x')).toEqual(unknownChapter);
  });
});

describe('a built chapter takes its name from its moves (R-104)', () => {
  const nameOf = (g: RepertoireGraph, id = 'c1') =>
    g.chapters.find((c) => c.id === id)?.nameSource;

  it('is numbered while it has no moves, then named from the taxonomy', () => {
    expect(nameOf(empty)).toEqual({ kind: 'index', number: 1 });
    expect(nameOf(build('e4'))).toEqual({ kind: 'eco', eco: 'B00' });
    expect(nameOf(build('e4', 'e5', 'Nf3'))).toEqual({
      kind: 'eco',
      eco: 'C40',
    });
  });

  it('stays numbered while its line matches no opening', () => {
    expect(nameOf(build('a3'))).toEqual({ kind: 'index', number: 1 });
  });

  it('follows the main line, not a later alternative', () => {
    let g = build('e4', 'e5');
    g = mustAdd(addMove(g, 'c1', must(g.moves[0]).to, 'c5'));
    expect(nameOf(g)).toEqual({ kind: 'eco', eco: 'C20' });
  });

  it('goes back to a number past the other chapters when its moves go', () => {
    const g = withC2(build('e4'));
    expect(nameOf(mustAdd(removeMove(g, 'c1', START, 'e4')))).toEqual({
      kind: 'index',
      number: 3,
    });
    expect(nameOf(mustAdd(removeMove(build('e4'), 'c1', START, 'e4')))).toEqual(
      { kind: 'index', number: 1 },
    );
  });

  it('is renamed by a shorter line after a removal', () => {
    const g = build('e4', 'e5', 'Nf3');
    const fromNf3 = must(g.moves[1]).to;
    expect(nameOf(mustAdd(removeMove(g, 'c1', fromNf3, 'Nf3')))).toEqual({
      kind: 'eco',
      eco: 'C20',
    });
  });

  it('keeps a name its owner typed or its PGN header gave', () => {
    const custom = mustAdd(renameChapter(empty, 'c1', 'Mano'));
    expect(nameOf(mustAdd(addMove(custom, 'c1', START, 'e4')))).toEqual({
      kind: 'custom',
      name: 'Mano',
    });
    const header: RepertoireGraph = {
      ...empty,
      chapters: [
        {
          ...chapter('c1', START, 1),
          nameSource: { kind: 'header', name: 'H' },
        },
      ],
    };
    expect(nameOf(mustAdd(addMove(header, 'c1', START, 'e4')))).toEqual({
      kind: 'header',
      name: 'H',
    });
  });

  it('is not classified from a position other than the standard start', () => {
    const fromE4 = must(build('e4').moves[0]).to;
    const g: RepertoireGraph = {
      ...empty,
      chapters: [chapter('c1', fromE4, 1)],
    };
    expect(nameOf(mustAdd(addMove(g, 'c1', fromE4, 'e5')))).toEqual({
      kind: 'index',
      number: 1,
    });
  });

  it('renames only the edited chapter', () => {
    // Black's repertoire, so 1. a3 and 1. e4 are both the opponent's.
    const black: RepertoireGraph = { ...withC2(build('a3')), side: 'black' };
    const g = mustAdd(addMove(black, 'c2', START, 'e4'));
    expect(nameOf(g, 'c1')).toEqual({ kind: 'index', number: 1 });
    expect(nameOf(g, 'c2')).toEqual({ kind: 'eco', eco: 'B00' });
  });
});
