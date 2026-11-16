import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
} from '../repertoire/graph';
import type { QueueItem } from './queue';
import {
  answerReview,
  hintReview,
  nextReview,
  reviewCounts,
  startReviewSession,
  type ReviewSessionState,
} from './review-session';
import type { ReviewState } from './schedule';
import type { TrainingRepertoire } from './scope';

function graph(pgn: string): RepertoireGraph {
  const r = importPgn(pgn, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

// Two chapters sharing 1. e4 e5 2. Nf3 Nc6 3. Bc4.
const italian = graph(
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 *',
);
const reps: TrainingRepertoire[] = [{ id: 'r', graph: italian, active: true }];

// No Reviews to grade, so no move comes back: review-repeats.test.ts has those.
const NOW = new Date('2026-11-16T08:00:00Z');
const BOUNDS = { size: 20, dayEnd: new Date('2026-11-16T22:00:00Z') };
const CLOCK = { now: NOW, reviews: new Map<string, ReviewState>() };

function itemIn(
  g: RepertoireGraph,
  san: string,
  repertoireId = 'r',
): QueueItem {
  const m = g.moves.find((x) => x.san === san && isPlayerMove(g, x));
  if (m === undefined) throw new Error(san);
  return { key: moveKey(m.from, m.san), repertoireId, fromKey: m.from, san };
}
const item = (san: string) => itemIn(italian, san);
const all = ['e4', 'Nf3', 'Bc4', 'c3', 'd3'].map(item);

const sans = (s: ReviewSessionState) => s.current?.line.moves.map((m) => m.san);
const currentSan = (s: ReviewSessionState) => s.current?.item.san;

/** Answers the current item right and moves on. */
const pass = (s: ReviewSessionState, r = reps) =>
  nextReview(answerReview(s, s.current?.item.san ?? '', CLOCK).state, r, NOW);

describe('reviewSession', () => {
  it('starts with the first item, asked after its line so far', () => {
    const s = startReviewSession(all, reps, BOUNDS);
    expect(s.current?.item).toEqual(item('e4'));
    expect(s.current?.reply).toBeNull();
    expect(s).toMatchObject({ phase: 'ask', hinted: false });
    expect(reviewCounts(s)).toEqual({
      done: 0,
      total: 5,
      passed: 0,
      lapses: 0,
    });

    const c3 = startReviewSession([item('c3')], reps, BOUNDS);
    expect(sans(c3)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']);
    expect(c3.current?.line.chapterId).toBe(italian.chapters[0]?.id);
  });
  it('a right answer emits a pass', () => {
    const s = startReviewSession(all, reps, BOUNDS);
    const t = answerReview(s, 'e4', CLOCK);
    expect(t.emit).toEqual({
      key: item('e4').key,
      repertoireId: 'r',
      outcome: 'pass',
      review: null,
    });
    expect(t.state.phase).toBe('correct');
    expect(t.state.outcomes.get(item('e4').key)).toBe('pass');
    expect(reviewCounts(t.state)).toEqual({
      done: 1,
      total: 5,
      passed: 1,
      lapses: 0,
    });
  });
  it('chains into the queued move after the opponent reply (R-143)', () => {
    const s = pass(startReviewSession(all, reps, BOUNDS));
    expect(currentSan(s)).toBe('Nf3');
    expect(s.current?.reply?.san).toBe('e5');
    expect(sans(s)).toEqual(['e4', 'e5', 'Nf3']);
    expect(s).toMatchObject({ phase: 'ask', hinted: false });
  });
  it('moves a chained item to be next in order', () => {
    const s = pass(
      startReviewSession([item('e4'), item('c3'), item('Nf3')], reps, BOUNDS),
    );
    expect(currentSan(s)).toBe('Nf3');
    expect(s.order.map((i) => i.san)).toEqual(['e4', 'Nf3', 'c3']);
    const after = pass(pass(s));
    expect(currentSan(after)).toBeUndefined();
    expect(reviewCounts(after)).toEqual({
      done: 3,
      total: 3,
      passed: 3,
      lapses: 0,
    });
  });
  it('without a chain takes the next item in order, with no reply', () => {
    const s = pass(startReviewSession([item('e4'), item('c3')], reps, BOUNDS));
    expect(currentSan(s)).toBe('c3');
    expect(s.current?.reply).toBeNull();
    expect(sans(s)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']);
  });
  it("chains only within the current item's chapter", () => {
    // In the first chapter Bc4 is answered by Bc5 only; d3 follows Nf6.
    const s = pass(startReviewSession([item('Bc4'), item('d3')], reps, BOUNDS));
    expect(currentSan(s)).toBe('d3');
    expect(s.current?.reply).toBeNull();
  });
  it('tries each opponent reply in insertion order', () => {
    const g = graph('1. e4 e5 (1... c5 2. c3) 2. Nf3 *');
    const r = [{ id: 'x', graph: g, active: true }];
    const items = ['e4', 'c3', 'Nf3'].map((san) => itemIn(g, san, 'x'));
    const s = pass(
      startReviewSession(
        items.filter((i) => i.san !== 'Nf3'),
        r,
        BOUNDS,
      ),
      r,
    );
    expect(currentSan(s)).toBe('c3');
    expect(s.current?.reply?.san).toBe('c5');
    expect(sans(s)).toEqual(['e4', 'c5', 'c3']);
    const both = pass(startReviewSession(items, r, BOUNDS), r);
    expect(currentSan(both)).toBe('Nf3');
    expect(both.current?.reply?.san).toBe('e5');
  });
  it("chains only to an item of the current item's repertoire (R-54)", () => {
    const a = graph('1. e4 e5 2. Nf3 *');
    const b = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 *');
    const r = [
      { id: 'a', graph: a, active: true },
      { id: 'b', graph: b, active: true },
    ];
    const items = [itemIn(a, 'e4', 'a'), itemIn(b, 'Nf3', 'b')];
    const s = pass(startReviewSession(items, r, BOUNDS), r);
    expect(s.current?.item).toEqual(itemIn(b, 'Nf3', 'b'));
    expect(s.current?.reply).toBeNull();
    expect(s.current?.line.chapterId).toBe(b.chapters[0]?.id);
  });
  it('passes over a reply the chapter does not answer', () => {
    const g = graph('1. e4 c5 (1... e5 2. Nf3) *');
    const r = [{ id: 'x', graph: g, active: true }];
    const items = ['e4', 'Nf3'].map((san) => itemIn(g, san, 'x'));
    const s = pass(startReviewSession(items, r, BOUNDS), r);
    expect(currentSan(s)).toBe('Nf3');
    expect(s.current?.reply?.san).toBe('e5');
  });
  it('ends when the repertoire is gone while drilling', () => {
    const s = pass(startReviewSession(all, reps, BOUNDS), []);
    expect(s.current).toBeNull();
    expect(reviewCounts(s)).toEqual({
      done: 1,
      total: 1,
      passed: 1,
      lapses: 0,
    });
  });
  it("keeps the current line's chapter on a chained line", () => {
    const s = pass(pass(startReviewSession(all, reps, BOUNDS)));
    expect(currentSan(s)).toBe('Bc4');
    expect(s.current?.line.chapterId).toBe(italian.chapters[0]?.id);
    expect(s.current?.line.rootKey).toBe(italian.chapters[0]?.rootKey);
  });
  it('counts a wrong answer and a hint as Lapses, a right answer as passed (R-61)', () => {
    const wrong = answerReview(
      startReviewSession(all, reps, BOUNDS),
      'd4',
      CLOCK,
    ).state;
    const replayed = nextReview(
      answerReview(wrong, 'e4', CLOCK).state,
      reps,
      NOW,
    );
    const hinted = hintReview(replayed, CLOCK).state;
    const passed = pass(
      nextReview(
        answerReview(hinted, hinted.current?.item.san ?? '', CLOCK).state,
        reps,
        NOW,
      ),
    );
    expect(reviewCounts(passed)).toEqual({
      done: 3,
      total: 5,
      passed: 1,
      lapses: 2,
    });
  });
  it('a wrong answer is a Lapse, recorded once; then replay the move (R-59)', () => {
    const s = startReviewSession(all, reps, BOUNDS);
    const wrong = answerReview(s, 'd4', CLOCK);
    expect(wrong.emit).toEqual({
      key: item('e4').key,
      repertoireId: 'r',
      outcome: 'lapse',
      review: null,
    });
    expect(wrong.state.phase).toBe('replay');

    const again = answerReview(wrong.state, 'c4', CLOCK);
    expect(again.emit).toBeNull();
    expect(again.state.phase).toBe('replay');

    const right = answerReview(again.state, 'e4', CLOCK);
    expect(right.emit).toBeNull();
    expect(right.state.phase).toBe('correct');
    expect(right.state.outcomes.get(item('e4').key)).toBe('lapse');
  });
  it('a hint is recorded once and the right move then emits nothing (R-61)', () => {
    const s = startReviewSession(all, reps, BOUNDS);
    const hinted = hintReview(s, CLOCK);
    expect(hinted.emit).toEqual({
      key: item('e4').key,
      repertoireId: 'r',
      outcome: 'hint',
      review: null,
    });
    expect(hinted.state.hinted).toBe(true);
    expect(hinted.state.phase).toBe('ask');

    const twice = hintReview(hinted.state, CLOCK);
    expect(twice.emit).toBeNull();
    expect(twice.state).toBe(hinted.state);

    const wrong = answerReview(hinted.state, 'd4', CLOCK);
    expect(wrong.emit).toBeNull();
    expect(wrong.state.phase).toBe('replay');
    expect(wrong.state.outcomes.get(item('e4').key)).toBe('hint');

    const wrongAgain = answerReview(wrong.state, 'c4', CLOCK);
    expect(wrongAgain.emit).toBeNull();
    expect(wrongAgain.state).toBe(wrong.state);

    const replayed = answerReview(wrong.state, 'e4', CLOCK);
    expect(replayed.emit).toBeNull();
    expect(replayed.state.phase).toBe('correct');

    const right = answerReview(hinted.state, 'e4', CLOCK);
    expect(right.emit).toBeNull();
    expect(right.state.phase).toBe('correct');
    expect(right.state.outcomes.get(item('e4').key)).toBe('hint');
    expect(nextReview(right.state, reps, NOW).hinted).toBe(false);
  });
  it('answer, hint and next do nothing out of turn', () => {
    const s = startReviewSession(all, reps, BOUNDS);
    expect(nextReview(s, reps, NOW)).toBe(s);
    const replay = answerReview(s, 'd4', CLOCK).state;
    expect(nextReview(replay, reps, NOW)).toBe(replay);
    const correct = answerReview(s, 'e4', CLOCK).state;
    expect(answerReview(correct, 'e4', CLOCK)).toEqual({
      state: correct,
      emit: null,
    });
    expect(hintReview(correct, CLOCK)).toEqual({ state: correct, emit: null });
  });
  it('ends with no current item once every item is answered', () => {
    let s = startReviewSession(all, reps, BOUNDS);
    const outcomes: string[] = [];
    while (s.current !== null) {
      const t = answerReview(s, s.current.item.san, CLOCK);
      if (t.emit !== null) outcomes.push(t.emit.key);
      s = nextReview(t.state, reps, NOW);
    }
    expect(outcomes.sort()).toEqual(all.map((i) => i.key).sort());
    expect(reviewCounts(s)).toEqual({
      done: 5,
      total: 5,
      passed: 5,
      lapses: 0,
    });
    expect(answerReview(s, 'e4', CLOCK)).toEqual({ state: s, emit: null });
    expect(hintReview(s, CLOCK)).toEqual({ state: s, emit: null });
    expect(nextReview(s, reps, NOW)).toBe(s);
  });
  it('skips an item no repertoire holds, never counting it', () => {
    const gone: QueueItem = { ...item('e4'), key: 'gone|e4', fromKey: 'gone' };
    const elsewhere: QueueItem = { ...item('Nf3'), repertoireId: 'other' };
    const s = startReviewSession([gone, elsewhere, item('c3')], reps, BOUNDS);
    expect(currentSan(s)).toBe('c3');
    expect(reviewCounts(s)).toEqual({
      done: 0,
      total: 1,
      passed: 0,
      lapses: 0,
    });
  });
  it('skips an item a coach edit removed while drilling', () => {
    const s = startReviewSession([item('e4'), item('c3')], reps, BOUNDS);
    const edited = [
      { id: 'r', graph: graph('1. e4 e5 2. Nf3 *'), active: true },
    ];
    const after = pass(s, edited);
    expect(after.current).toBeNull();
    expect(reviewCounts(after)).toEqual({
      done: 1,
      total: 1,
      passed: 1,
      lapses: 0,
    });
  });
});
