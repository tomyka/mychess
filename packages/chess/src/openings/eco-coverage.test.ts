import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ECO } from './data/eco';
import { ECO_LT } from './data/eco-lt';

interface LineNode {
  readonly children: Map<string, LineNode>;
  readonly ends: number[];
}

const lineNode = (): LineNode => ({ children: new Map(), ends: [] });

/**
 * The indexes of the lines that are not legal from the start. The lines
 * share long prefixes, so they are replayed as one tree: every position is
 * reached once, which keeps this test fast under coverage and load.
 */
function illegalLines(lines: readonly (readonly string[])[]): Set<number> {
  const root = lineNode();
  lines.forEach((moves, index) => {
    let node = root;
    for (const san of moves) {
      const next = node.children.get(san) ?? lineNode();
      node.children.set(san, next);
      node = next;
    }
    node.ends.push(index);
  });
  const illegal = new Set<number>();
  const game = new Chess();
  const allEnds = (node: LineNode): number[] => [
    ...node.ends,
    ...[...node.children.values()].flatMap(allEnds),
  ];
  const walk = (node: LineNode): void => {
    for (const [san, child] of node.children) {
      try {
        game.move(san);
      } catch {
        allEnds(child).forEach((index) => illegal.add(index));
        continue;
      }
      walk(child);
      game.undo();
    }
  };
  walk(root);
  return illegal;
}

// The tree replay is already the least work: about 1,100 chess.js moves for
// the 500 lines (4,818 moves replayed one by one). It runs in about 130 ms
// alone and 400 ms under coverage, but a gate run with coverage and a web
// build on the same machine still passed vitest's 5 s default (#287). Each
// chess.js move generates every legal move and two FENs, so the test is
// CPU-bound and gets a budget that survives a starved machine.
const REPLAYING_THE_ECO_TREE = 30_000;

describe('ECO table', () => {
  it('has one entry for every code from A00 to E99, in order', () => {
    const codes = ['A', 'B', 'C', 'D', 'E'].flatMap((volume) =>
      Array.from(
        { length: 100 },
        (_, n) => `${volume}${String(n).padStart(2, '0')}`,
      ),
    );
    expect(ECO.map((entry) => entry.code)).toEqual(codes);
  });

  it(
    'gives every entry an English name and a line legal from the start',
    () => {
      const illegal = illegalLines(ECO.map((entry) => entry.moves));
      const broken = ECO.filter(
        (entry, i) =>
          illegal.has(i) ||
          entry.name.trim() === '' ||
          entry.moves.length === 0,
      ).map((entry) => entry.code);
      expect(broken).toEqual([]);
    },
    REPLAYING_THE_ECO_TREE,
  );

  it('keeps known entries', () => {
    expect(ECO.find((entry) => entry.code === 'B90')).toEqual({
      code: 'B90',
      name: 'Sicilian Defense: Najdorf Variation',
      moves: [
        'e4',
        'c5',
        'Nf3',
        'd6',
        'd4',
        'cxd4',
        'Nxd4',
        'Nf6',
        'Nc3',
        'a6',
      ],
    });
  });
});

describe('Lithuanian ECO coverage', () => {
  it('names every code that the English data carries', () => {
    const missing = ECO.map((entry) => entry.code).filter(
      (code) => !(code in ECO_LT),
    );
    // A non-empty list means the English generator introduced codes that the
    // Lithuanian generator has not been re-run for. Those codes fall back to
    // English rather than rendering blank, so this is a prompt to regenerate,
    // not an outage.
    expect(missing).toEqual([]);
  });

  it('carries no Lithuanian name for a code the English data does not have', () => {
    const codes = new Set(ECO.map((entry) => entry.code));
    expect(Object.keys(ECO_LT).filter((code) => !codes.has(code))).toEqual([]);
  });

  it('has no blank names', () => {
    expect(
      Object.entries(ECO_LT).filter(([, name]) => name.trim() === ''),
    ).toEqual([]);
  });

  it('keeps known names', () => {
    expect(ECO_LT['A00']).toBe('Nepopuliarūs debiutai');
    expect(ECO_LT['E99']).toBe(
      'Karaliaus Indiška gynyba, Ortodoksinis variantas, Pagrindinis Aronino-Taimanovo variantas',
    );
  });
});
