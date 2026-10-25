import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { START_KEY } from '../position-key';
import { moveKey, type RepertoireGraph, type Side } from '../repertoire/graph';
import { learnAgainKeys, twoAnswers } from './answers';
import { grade, startReview, type ReviewState } from './schedule';
import type { Scope, TrainingRepertoire } from './scope';

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

describe('twoAnswers (R-54)', () => {
  const e4 = rep('e4', graph('1. e4 e5 *'));
  const d4 = rep('d4', graph('1. d4 d5 *'));
  const sameE4 = rep('same', graph('1. e4 c5 *'));
  const black = rep('black', graph('1. e4 e5 *', 'black'));

  it('names the repertoire that answers otherwise', () => {
    expect(twoAnswers(START_KEY, 'e4', [e4, d4])).toEqual([
      { repertoireId: 'd4', san: 'd4' },
    ]);
    expect(twoAnswers(START_KEY, 'd4', [e4, d4])).toEqual([
      { repertoireId: 'e4', san: 'e4' },
    ]);
  });
  it('leaves out a repertoire with the same answer or none there', () => {
    expect(twoAnswers(START_KEY, 'e4', [e4, sameE4, black])).toEqual([]);
  });
  it('names a paused repertoire too', () => {
    const paused = rep('paused', graph('1. c4 *'), false);
    expect(twoAnswers(START_KEY, 'e4', [e4, paused, d4])).toEqual([
      { repertoireId: 'paused', san: 'c4' },
      { repertoireId: 'd4', san: 'd4' },
    ]);
  });
});

describe('learnAgainKeys (R-147)', () => {
  const g = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *');
  const keyOf = (san: string): string => {
    const m = g.moves.find((x) => x.san === san);
    if (m === undefined) throw new Error(san);
    return moveKey(m.from, m.san);
  };
  const chapterId = g.chapters[0]?.id ?? '';
  const scope: Scope = { kind: 'chapter', graph: g, chapterId };
  const now = new Date('2026-10-25T10:00:00Z');
  const later = new Date('2026-10-27T10:00:00Z');
  const e4 = keyOf('e4');
  const nf3 = keyOf('Nf3');
  const bc4 = keyOf('Bc4');
  const c3 = keyOf('c3');
  const reviews = new Map<string, ReviewState>([
    [e4, startReview(e4, now)],
    [nf3, startReview(nf3, now)],
    [bc4, startReview(bc4, now)],
  ]);

  it('returns a skipped key never drilled', () => {
    expect(learnAgainKeys(scope, reviews, new Set([e4]))).toEqual([e4]);
  });
  it('leaves out a skipped key drilled since', () => {
    const graded = new Map(reviews).set(
      nf3,
      grade(startReview(nf3, now), 'pass', later),
    );
    expect(learnAgainKeys(scope, graded, new Set([e4, nf3]))).toEqual([e4]);
  });
  it('leaves out a learned key and a skipped key without a review', () => {
    expect(learnAgainKeys(scope, reviews, new Set([c3]))).toEqual([]);
    expect(learnAgainKeys(scope, reviews, new Set())).toEqual([]);
  });
  it('keeps line order over the scope', () => {
    expect(learnAgainKeys(scope, reviews, new Set([bc4, e4, nf3]))).toEqual([
      e4,
      nf3,
      bc4,
    ]);
  });
});
