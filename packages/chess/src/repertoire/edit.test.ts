import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { addMove, removeMove, setMarks } from './edit';
import { lines, moveKey, type RepertoireGraph } from './graph';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);
const empty: RepertoireGraph = {
  side: 'white',
  chapters: [
    {
      id: 'c1',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', n: 1 },
    },
  ],
  moves: [],
};

function build(...sans: string[]): RepertoireGraph {
  let g = empty;
  let key = START;
  for (const san of sans) {
    const r = addMove(g, 'c1', key, san);
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    key = g.moves.find((m) => m.from === key && m.san === san)?.to ?? key;
  }
  return g;
}

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

  it('refuses an illegal move', () => {
    expect(addMove(empty, 'c1', START, 'e5')).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.illegalMove' },
    });
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
    const g: RepertoireGraph = {
      ...build('e4'),
      chapters: [
        ...empty.chapters,
        {
          id: 'c2',
          rootKey: START,
          intro: null,
          nameSource: { kind: 'index', n: 2 },
        },
      ],
    };
    expect(addMove(g, 'c2', START, 'd4')).toEqual({
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

  it('adds the chapter to an existing move instead of duplicating it', () => {
    const g: RepertoireGraph = {
      ...build('e4'),
      chapters: [
        ...empty.chapters,
        {
          id: 'c2',
          rootKey: START,
          intro: null,
          nameSource: { kind: 'index', n: 2 },
        },
      ],
    };
    const r = addMove(g, 'c2', START, 'e4');
    expect(r.ok && r.value.moves).toEqual([
      expect.objectContaining({ chapters: ['c1', 'c2'] }),
    ]);
  });

  it('stores the UCI of a promotion with its piece', () => {
    const fen = 'k7/4P3/8/8/8/8/8/K7 w - - 0 1';
    const root = positionKey(fen);
    const g: RepertoireGraph = {
      ...empty,
      chapters: [
        {
          id: 'c1',
          rootKey: root,
          intro: null,
          nameSource: { kind: 'index', n: 1 },
        },
      ],
    };
    const r = addMove(g, 'c1', root, 'e8=Q+');
    expect(r.ok && r.value.moves).toEqual([
      expect.objectContaining({
        san: 'e8=Q+',
        uci: 'e7e8q',
        to: positionKey('k3Q3/8/8/8/8/8/8/K7 b - - 0 1'),
      }),
    ]);
  });

  it('ends a line at a repetition instead of looping', () => {
    const g = build('Nf3', 'Nf6', 'Ng1', 'Ng8');
    expect(g.moves.at(-1)?.to).toBe(START);
    expect(lines(g, 'c1').map((l) => l.map((m) => m.san))).toEqual([
      ['Nf3', 'Nf6', 'Ng1'],
    ]);
  });
});

describe('removeMove', () => {
  it('removes the move and every move only it reached', () => {
    const g = removeMove(build('e4', 'e5', 'Nf3'), 'c1', START, 'e4');
    expect(g.moves).toEqual([]);
  });

  it('keeps moves still reachable another way (transposition)', () => {
    // 1.d4 Nf6 2.c4 e6 3.Nc3 and 1.d4 e6 2.c4 Nf6 reach the same position.
    let g = build('d4', 'Nf6', 'c4', 'e6', 'Nc3');
    const afterD4 = must(g.moves[0]).to;
    for (const [from, san] of [[afterD4, 'e6']] as const) {
      const r = addMove(g, 'c1', from, san);
      if (!r.ok) throw new Error(r.refusal.reason);
      g = r.value;
    }
    const afterE6 = must(
      g.moves.find((m) => m.from === afterD4 && m.san === 'e6'),
    ).to;
    let r = addMove(g, 'c1', afterE6, 'c4');
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    const afterC4 = must(
      g.moves.find((m) => m.from === afterE6 && m.san === 'c4'),
    ).to;
    r = addMove(g, 'c1', afterC4, 'Nf6');
    if (!r.ok) throw new Error(r.refusal.reason);
    g = r.value;
    // Removing 1...Nf6 must keep 3.Nc3: the 1...e6 order still reaches it.
    g = removeMove(g, 'c1', afterD4, 'Nf6');
    expect(g.moves.some((m) => m.san === 'Nc3')).toBe(true);
    expect(g.moves.some((m) => m.san === 'Nf6' && m.from === afterD4)).toBe(
      false,
    );
    expect(lines(g, 'c1').map((l) => l.map((m) => m.san))).toEqual([
      ['d4', 'e6', 'c4', 'Nf6', 'Nc3'],
    ]);
  });

  it('keeps a move another chapter still uses', () => {
    const g: RepertoireGraph = {
      ...build('e4', 'e5'),
      chapters: [
        ...empty.chapters,
        {
          id: 'c2',
          rootKey: START,
          intro: null,
          nameSource: { kind: 'index', n: 2 },
        },
      ],
    };
    const r = addMove(g, 'c2', START, 'e4');
    if (!r.ok) throw new Error(r.refusal.reason);
    const after = removeMove(r.value, 'c1', START, 'e4');
    expect(after.moves).toEqual([
      expect.objectContaining({ san: 'e4', chapters: ['c2'] }),
    ]);
  });
});

describe('setMarks', () => {
  it('sets arrows and circles on a move', () => {
    const r = setMarks(build('e4'), START, 'e4', {
      arrows: [{ from: 'e2', to: 'e4', color: 'G' }],
      circles: [{ square: 'd5', color: 'R' }],
    });
    expect(r.ok && r.value.moves[0]).toEqual(
      expect.objectContaining({
        arrows: [{ from: 'e2', to: 'e4', color: 'G' }],
        circles: [{ square: 'd5', color: 'R' }],
      }),
    );
  });

  it('refuses marks on a move that does not exist', () => {
    expect(
      setMarks(build('e4'), START, 'd4', { arrows: [], circles: [] }),
    ).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.unknownMove' },
    });
    expect(moveKey(START, 'd4')).toContain('|d4');
  });
});
