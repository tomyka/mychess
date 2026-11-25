import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { ECO, ECO_FAMILIES } from './data/eco';

interface LineNode {
  readonly children: Map<string, LineNode>;
  readonly ends: number[];
}

const lineNode = (): LineNode => ({ children: new Map(), ends: [] });

/**
 * The key each line ends in, null when one of its moves is illegal. The lines
 * share long prefixes, so they are replayed as one tree: every position is
 * reached once, which keeps this test fast under coverage and load.
 */
function replayedKeys(
  lines: readonly (readonly string[])[],
): (string | null)[] {
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
  const keys: (string | null)[] = lines.map(() => null);
  const game = new Chess();
  const walk = (node: LineNode): void => {
    for (const index of node.ends) keys[index] = positionKey(game.fen());
    for (const [san, child] of node.children) {
      try {
        game.move(san);
      } catch {
        continue;
      }
      walk(child);
      game.undo();
    }
  };
  walk(root);
  return keys;
}

// The tree replay is already the least work: about 8,800 chess.js moves for
// the 3,865 lines (37,700 moves replayed one by one), plus one position key
// per line. It runs in about 0.9 s alone and 3.3 s under coverage; with 500
// lines a gate run with coverage and a web build on the same machine already
// pushed it towards vitest's 5 s default (#287). Each chess.js move generates
// every legal move and two FENs, so the test is CPU-bound and gets a budget
// that survives a starved machine.
const REPLAYING_THE_ECO_TREE = 30_000;

describe('ECO table', () => {
  it('has a family line for every code from A00 to E99, in order', () => {
    const codes = ['A', 'B', 'C', 'D', 'E'].flatMap((volume) =>
      Array.from(
        { length: 100 },
        (_, n) => `${volume}${String(n).padStart(2, '0')}`,
      ),
    );
    expect(ECO_FAMILIES.map((entry) => entry.code)).toEqual(codes);
  });

  it(
    'gives every entry an English name and stores the key its line reaches',
    () => {
      const keys = replayedKeys(ECO.map((entry) => entry.moves));
      const broken = ECO.filter(
        (entry, i) =>
          keys[i] !== entry.key ||
          entry.name.trim() === '' ||
          entry.moves.length === 0,
      ).map((entry) => entry.code);
      expect(broken).toEqual([]);
    },
    REPLAYING_THE_ECO_TREE,
  );

  it('keeps known entries', () => {
    expect(
      ECO.find((entry) => entry.code === 'B90' && entry.moves.length === 10),
    ).toEqual({
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
      key: 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -',
    });
  });
});
