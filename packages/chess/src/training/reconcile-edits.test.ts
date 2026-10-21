/**
 * Reconciliation under arbitrary coach edits (R-23, R-53, R-121, ruling
 * Q30): for any sequence of builder edits, the keys a player held before and
 * holds after split into kept, to learn and dormant, and the edit's player
 * move changes name the same keys.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { legalMoves } from '../legal-moves';
import { importPgn } from '../pgn/import-pgn';
import { netMoveChanges, playerMoveChanges } from '../repertoire/changes';
import { addMove, removeMove } from '../repertoire/edit';
import type { Chapter, RepertoireGraph, Side } from '../repertoire/graph';
import { chapterWalks } from '../repertoire/walk';
import { reconcile } from './progress';
import { heldKeys, scopeKeys, type TrainingRepertoire } from './scope';

function graphOf(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

/**
 * Two chapters per side, with variations; the white Italian chapter holds a
 * transposition (1... e5 2. Nf3 Nc6 and 1... Nc6 2. Nf3 e5 meet), and the
 * Scotch shares its first moves with the Italian.
 */
const WHITE = `[Event "Italian"]

1. e4 e5 (1... Nc6 2. Nf3 e5) 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4 Bc5 (3... Nf6 4. Ng5) 4. c3 *

[Event "Scotch"]

1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 *`;

const BLACK = `[Event "Sicilian"]

1. e4 c5 2. Nf3 (2. Nc3 Nc6) d6 3. d4 cxd4 4. Nxd4 Nf6 *

[Event "Indian"]

1. d4 Nf6 2. c4 (2. Nf3 g6) e6 *`;

const BASES = [graphOf(WHITE, 'white'), graphOf(BLACK, 'black')] as const;

/** One builder edit: add or remove, in a chapter, at a position, which move. */
type Step = readonly [add: boolean, chapter: number, at: number, pick: number];

const pickFrom = <T>(items: readonly T[], n: number): T | undefined =>
  items[n % Math.max(items.length, 1)];

/** Adds a legal move from a position the chapter reaches; a refusal is no edit. */
function addStep(
  graph: RepertoireGraph,
  chapter: Chapter,
  [, , at, pick]: Step,
): RepertoireGraph {
  const reached = [
    chapter.rootKey,
    ...chapterWalks(graph)(chapter.id)
      .moves()
      .map((m) => m.to),
  ];
  const from = pickFrom(reached, at) ?? chapter.rootKey;
  const move = pickFrom(legalMoves(from), pick);
  if (move === undefined) return graph;
  const r = addMove(graph, chapter.id, from, move.san);
  return r.ok ? r.value : graph;
}

/** Removes one of the chapter's moves, with what only it reached. */
function removeStep(
  graph: RepertoireGraph,
  chapter: Chapter,
  [, , at]: Step,
): RepertoireGraph {
  const move = pickFrom(chapterWalks(graph)(chapter.id).moves(), at);
  if (move === undefined) return graph;
  const r = removeMove(graph, chapter.id, move.from, move.san);
  return r.ok ? r.value : graph;
}

function applyStep(graph: RepertoireGraph, step: Step): RepertoireGraph {
  const chapter = pickFrom(graph.chapters, step[1]);
  if (chapter === undefined) return graph;
  return step[0]
    ? addStep(graph, chapter, step)
    : removeStep(graph, chapter, step);
}

/** Every graph along the edits, the base first. */
const versions = (base: RepertoireGraph, steps: readonly Step[]) =>
  steps.reduce<RepertoireGraph[]>(
    (acc, step) => [...acc, applyStep(acc[acc.length - 1] ?? base, step)],
    [base],
  );

const heldBy = (graph: RepertoireGraph): ReadonlySet<string> =>
  heldKeys([{ id: 'r', graph, active: true } satisfies TrainingRepertoire]);

const minus = (a: ReadonlySet<string>, b: ReadonlySet<string>): string[] =>
  [...a].filter((k) => !b.has(k)).sort();

const sortedKeys = (links: readonly { moveKey: string }[]): string[] =>
  [...new Set(links.map((l) => l.moveKey))].sort();

const step: fc.Arbitrary<Step> = fc.tuple(
  fc.boolean(),
  fc.nat(3),
  fc.nat(40),
  fc.nat(40),
);
const edits = fc.tuple(
  fc.constantFrom(...BASES),
  fc.array(step, { minLength: 1, maxLength: 8 }),
);

interface Edited {
  readonly before: RepertoireGraph;
  readonly after: RepertoireGraph;
  readonly path: readonly RepertoireGraph[];
}

const edited = (base: RepertoireGraph, steps: readonly Step[]): Edited => {
  const path = versions(base, steps);
  return { before: base, after: path[path.length - 1] ?? base, path };
};

/** Runs a property over arbitrary edits of each base repertoire. */
function forAnyEdit(check: (e: Edited) => void): void {
  fc.assert(
    fc.property(edits, ([base, steps]) => {
      check(edited(base, steps));
    }),
    { numRuns: 100 },
  );
}

describe('reconcile across arbitrary coach edits (R-23, R-53, R-121)', () => {
  it('keeps the keys held before and after, queues the new ones and parks the removed ones', () => {
    forAnyEdit(({ before, after }) => {
      const was = heldBy(before);
      const now = heldBy(after);
      const reviews = new Map([...was].map((k) => [k, k]));
      expect(
        reconcile([{ id: 'r', graph: after, active: true }], reviews),
      ).toEqual({
        kept: [...now].filter((k) => was.has(k)).sort(),
        toLearn: minus(now, was),
        dormant: minus(was, now),
      });
    });
  });

  it('names the same added and removed keys in the edit as reconcile does', () => {
    forAnyEdit(({ before, after }) => {
      const r = reconcile(
        [{ id: 'r', graph: after, active: true }],
        new Map([...heldBy(before)].map((k) => [k, k])),
      );
      const changes = playerMoveChanges(before, after);
      expect(sortedKeys(changes.added)).toEqual(r.toLearn);
      expect(sortedKeys(changes.removed)).toEqual(r.dormant);
    });
  });

  it('nets the step-by-step changes to the same keys, a key removed and re-added included', () => {
    forAnyEdit(({ before, after, path }) => {
      const steps = path
        .slice(1)
        .map((graph, i) => playerMoveChanges(path[i] ?? before, graph));
      const net = netMoveChanges(steps);
      expect(sortedKeys(net.added)).toEqual(
        minus(heldBy(after), heldBy(before)),
      );
      expect(sortedKeys(net.removed)).toEqual(
        minus(heldBy(before), heldBy(after)),
      );
    });
  });

  it('holds exactly the keys its chapters cover', () => {
    forAnyEdit(({ after }) => {
      const covered = after.chapters.flatMap((c) =>
        scopeKeys({ kind: 'chapter', graph: after, chapterId: c.id }),
      );
      expect(new Set(covered)).toEqual(heldBy(after));
    });
  });
});
