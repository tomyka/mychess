import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import { learnPlan, type LearnLine } from './learn-plan';
import type { TrainingRepertoire } from './scope';

function graph(pgn: string, side: Side = 'white'): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
const rep = (
  id: string,
  g: RepertoireGraph,
  active = true,
): TrainingRepertoire => ({ id, graph: g, active });
const steps = (line: LearnLine | undefined) =>
  line?.steps.map((s) => `${s.kind}:${s.move.san}`);
const keyOf = (g: RepertoireGraph, san: string) => {
  const m = g.moves.find((x) => x.san === san);
  if (m === undefined) throw new Error(san);
  return moveKey(m.from, m.san);
};

// Two chapters sharing 1. e4 e5 2. Nf3 Nc6 3. Bc4.
const italian = graph(
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 *',
);

describe('learnPlan', () => {
  it('tags each step of the first line', () => {
    const [first] = learnPlan([rep('r', italian)], new Set(), 10);
    expect(steps(first)).toEqual([
      'new:e4',
      'opponent:e5',
      'new:Nf3',
      'opponent:Nc6',
      'new:Bc4',
      'opponent:Bc5',
      'new:c3',
    ]);
    expect(first?.repertoireId).toBe('r');
  });
  it('names the chapter and its root', () => {
    const [first, second] = learnPlan([rep('r', italian)], new Set(), 10);
    expect(first?.chapterId).toBe(italian.chapters[0]?.id);
    expect(first?.rootKey).toBe(italian.chapters[0]?.rootKey);
    expect(second?.chapterId).toBe(italian.chapters[1]?.id);
  });
  it('gives each step its move key', () => {
    const [first] = learnPlan([rep('r', italian)], new Set(), 10);
    expect(first?.steps.map((s) => s.key)).toEqual(
      first?.steps.map((s) => moveKey(s.move.from, s.move.san)),
    );
    expect(first?.steps[0]?.key).toBe(keyOf(italian, 'e4'));
  });
  it('does not teach a shared move twice (U1-M1-4)', () => {
    const [, second] = learnPlan([rep('r', italian)], new Set(), 10);
    expect(steps(second)).toEqual([
      'known:e4',
      'opponent:e5',
      'known:Nf3',
      'opponent:Nc6',
      'known:Bc4',
      'opponent:Nf6',
      'new:d3',
    ]);
  });
  it('treats learned keys as known and skips lines with nothing new', () => {
    const learned = new Set(
      ['e4', 'Nf3', 'Bc4', 'c3'].map((s) => keyOf(italian, s)),
    );
    const plan = learnPlan([rep('r', italian)], learned, 10);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.chapterId).toBe(italian.chapters[1]?.id);
    expect(steps(plan[0])?.at(-1)).toBe('new:d3');
    expect(steps(plan[0])?.[0]).toBe('known:e4');
  });
  it('cuts the line after the limit-th new move (R-144)', () => {
    const plan = learnPlan([rep('r', italian)], new Set(), 2);
    expect(plan).toHaveLength(1);
    expect(steps(plan[0])).toEqual(['new:e4', 'opponent:e5', 'new:Nf3']);
  });
  it('plans the next line when the limit is reached exactly at a line end', () => {
    const plan = learnPlan([rep('r', italian)], new Set(), 4);
    expect(plan).toHaveLength(1);
    expect(steps(plan[0])?.at(-1)).toBe('new:c3');
  });
  it('plans nothing at limit 0 and skips paused repertoires', () => {
    expect(learnPlan([rep('r', italian)], new Set(), 0)).toEqual([]);
    expect(learnPlan([rep('r', italian, false)], new Set(), 10)).toEqual([]);
  });
  it('follows the given repertoire order (R-145)', () => {
    const london = graph('1. d4 d5 2. Bf4 *');
    const plan = learnPlan([rep('b', london), rep('a', italian)], new Set(), 3);
    expect(plan.map((l) => l.repertoireId)).toEqual(['b', 'a']);
    expect(steps(plan[1])).toEqual(['new:e4']);
  });
  it('starts a black line with the opponent move', () => {
    const sicilian = graph('1. e4 c5 2. Nf3 d6 *', 'black');
    expect(steps(learnPlan([rep('s', sicilian)], new Set(), 10)[0])).toEqual([
      'opponent:e4',
      'new:c5',
      'opponent:Nf3',
      'new:d6',
    ]);
  });
  it('plans each branch of a chapter as its own line from the root', () => {
    const g = graph('1. e4 e5 (1... c5 2. Nf3) 2. Nc3 *');
    expect(learnPlan([rep('r', g)], new Set(), 10).map(steps)).toEqual([
      ['new:e4', 'opponent:e5', 'new:Nc3'],
      ['known:e4', 'opponent:c5', 'new:Nf3'],
    ]);
  });

  const playerKeys = italian.moves
    .filter((m) => isPlayerMove(italian, m))
    .map((m) => moveKey(m.from, m.san));

  it('teaches min(limit, unlearned) moves, each once, none learned', () => {
    fc.assert(
      fc.property(
        fc.subarray(playerKeys),
        fc.integer({ min: 0, max: 10 }),
        (learnedKeys, limit) => {
          const learned = new Set(learnedKeys);
          const taught = learnPlan([rep('r', italian)], learned, limit)
            .flatMap((l) => l.steps)
            .filter((s) => s.kind === 'new')
            .map((s) => s.key);
          const unlearned = playerKeys.length - learned.size;
          expect(taught).toHaveLength(Math.min(limit, unlearned));
          expect(new Set(taught).size).toBe(taught.length);
          expect(taught.filter((k) => learned.has(k))).toEqual([]);
        },
      ),
    );
  });
});
