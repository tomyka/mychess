// R-78 inside one review session: a move answered wrong comes back when its
// FSRS relearning step runs out, not at the end of the session (#338).
import fc from 'fast-check';
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
  reviewProgress,
  startReviewSession,
  type ReviewSessionState,
  type ReviewTransition,
} from './review-session';
import { DAY_MS, grade, startReview, type ReviewState } from './schedule';
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

function item(san: string): QueueItem {
  const m = italian.moves.find(
    (x) => x.san === san && isPlayerMove(italian, x),
  );
  if (m === undefined) throw new Error(san);
  return {
    key: moveKey(m.from, m.san),
    repertoireId: 'r',
    fromKey: m.from,
    san,
  };
}

const MINUTE = 60_000;
const T0 = new Date('2026-11-16T08:00:00Z');
const DAY_END = new Date('2026-11-16T22:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

/** A session and the player's Reviews, graded as the session answers them. */
interface Drill {
  readonly s: ReviewSessionState;
  readonly reviews: ReadonlyMap<string, ReviewState>;
}

/** A Review past its learning steps, due at T0: a Lapse relearns for 10 minutes. */
function graduated(key: string): ReviewState {
  const learnt = startReview(key, new Date(T0.getTime() - 3 * DAY_MS));
  const review = grade(learnt, 'pass', learnt.fsrs.due);
  return { ...review, fsrs: { ...review.fsrs, due: T0 } };
}

/** A Review first due at T0, still in its learning steps (1 and 10 minutes). */
const learning = (key: string): ReviewState =>
  startReview(key, new Date(T0.getTime() - DAY_MS));

/** Reviews of `items`, each due at T0. */
const dueAtT0 = (items: readonly QueueItem[], review = graduated) =>
  new Map(items.map((i) => [i.key, review(i.key)]));

function start(
  items: readonly QueueItem[],
  size = 20,
  review = graduated,
): Drill {
  return {
    s: startReviewSession(items, reps, { size, dayEnd: DAY_END }),
    reviews: dueAtT0(items, review),
  };
}

/** Keeps the Review the answer graded, as a caller does. */
function graded(d: Drill, t: ReviewTransition): Drill {
  const review = t.emit?.review ?? null;
  if (t.emit === null || review === null) return { ...d, s: t.state };
  return { s: t.state, reviews: new Map(d.reviews).set(t.emit.key, review) };
}

/** Answers the current move at `now`, wrong first if `wrong`, then moves on at `next`. */
function answer(d: Drill, now: Date, wrong = false, next = now): Drill {
  const san = d.s.current?.item.san ?? '';
  const clock = { now, reviews: d.reviews };
  const first = graded(d, answerReview(d.s, wrong ? 'a3' : san, clock));
  const done = wrong ? graded(first, answerReview(first.s, san, clock)) : first;
  return { ...done, s: nextReview(done.s, reps, next) };
}

/** The answer's clock: its time and the Reviews before it. */
const clockOf = (d: Drill, now: Date) => ({ now, reviews: d.reviews });

const currentSan = (d: Drill) => d.s.current?.item.san;
const dueOf = (d: Drill, san: string) =>
  d.reviews.get(item(san).key)?.fsrs.due.getTime() ?? NaN;

/**
 * How the asked move, chosen at `now`, breaks R-78's timing: a first ask
 * taken while a repeat is due, unless chained (R-143); a repeat asked early
 * while a first ask could still be taken.
 */
function outOfTime(
  s: ReviewSessionState,
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
): string[] {
  const view = s.current;
  if (view === null) return [];
  const waiting = s.repeats.some((r) => r.due.getTime() <= now.getTime());
  if (!view.repeat) return waiting && view.reply === null ? ['late'] : [];
  const due = reviews.get(view.item.key)?.fsrs.due.getTime() ?? NaN;
  const open = s.order.some((i) => !s.outcomes.has(i.key));
  const room = s.size - s.asked - s.repeats.length - 1 > 0;
  return due > now.getTime() && open && room ? ['early'] : [];
}

describe('repeats within a review session (R-78)', () => {
  it('owes the repeat from the answer on, before the session moves on', () => {
    const d = start([item('e4'), item('c3')]);
    const lapse = answerReview(d.s, 'a3', clockOf(d, at(0))).state;
    expect(lapse.repeats.map((r) => r.item.san)).toEqual(['e4']);
    expect(reviewProgress(lapse)).toEqual({ done: 1, total: 3 });
    const hint = hintReview(d.s, clockOf(d, at(0))).state;
    expect(reviewProgress(hint)).toEqual({ done: 1, total: 3 });
    const pass = answerReview(d.s, 'e4', clockOf(d, at(0))).state;
    expect(pass.repeats).toEqual([]);
    expect(reviewProgress(pass)).toEqual({ done: 1, total: 2 });
  });
  it('owes no repeat for a move it has no Review of', () => {
    const d = start([item('e4'), item('c3')]);
    const clock = { now: at(0), reviews: new Map<string, ReviewState>() };
    expect(answerReview(d.s, 'a3', clock).state.repeats).toEqual([]);
  });
  it('a Lapse waits for its relearning step, due within minutes', () => {
    const d = answer(start([item('e4'), item('c3'), item('d3')]), at(0), true);
    expect(currentSan(d)).toBe('c3');
    expect(d.s.current?.repeat).toBe(false);
    expect(d.s.repeats.map((r) => r.item.san)).toEqual(['e4']);
    const due = dueOf(d, 'e4');
    expect(d.s.repeats[0]?.due.getTime()).toBe(due);
    expect(due).toBeGreaterThan(at(0).getTime());
    expect(due).toBeLessThanOrEqual(at(10).getTime());
  });
  it('comes back before the next item once its step has run out', () => {
    const lapsed = answer(
      start([item('e4'), item('c3'), item('d3')]),
      at(0),
      true,
    );
    const later = (dueOf(lapsed, 'e4') - T0.getTime()) / MINUTE;
    const d = answer(lapsed, at(later - 1), false, at(later));
    expect(currentSan(d)).toBe('e4');
    expect(d.s.current?.repeat).toBe(true);
    expect(d.s.current?.reply).toBeNull();
    expect(d.s.current?.line.moves.map((m) => m.san)).toEqual(['e4']);
    expect(d.s.repeats).toEqual([]);
    expect(d.s.phase).toBe('ask');
  });
  it('waits while its step has not run out', () => {
    const lapsed = answer(
      start([item('e4'), item('c3'), item('d3')]),
      at(0),
      true,
    );
    const early = new Date(dueOf(lapsed, 'e4') - 1);
    const d = answer(lapsed, at(0), false, early);
    expect(currentSan(d)).toBe('d3');
    expect(d.s.repeats.map((r) => r.item.san)).toEqual(['e4']);
  });
  it('is asked early at the end rather than dropped', () => {
    const lapsed = answer(start([item('e4'), item('c3')]), at(0), true);
    const d = answer(lapsed, at(0));
    expect(currentSan(d)).toBe('e4');
    expect(d.s.current?.repeat).toBe(true);
  });
  it('emits each answer of a repeat; the counts keep each move by its first', () => {
    const lapsed = answer(start([item('e4'), item('c3')]), at(0), true);
    const repeat = answer(lapsed, at(0));
    const t = answerReview(repeat.s, 'e4', clockOf(repeat, at(0)));
    const before = repeat.reviews.get(item('e4').key);
    expect(t.emit).toEqual({
      key: item('e4').key,
      repertoireId: 'r',
      outcome: 'pass',
      review: before && grade(before, 'pass', at(0)),
    });
    expect(t.emit?.review?.fsrs.due.getTime()).toBeGreaterThan(
      DAY_END.getTime(),
    );
    expect(t.state.outcomes.get(item('e4').key)).toBe('lapse');
    expect(reviewCounts(t.state)).toEqual({
      done: 2,
      total: 2,
      passed: 1,
      lapses: 1,
    });
    expect(reviewProgress(t.state)).toEqual({ done: 3, total: 3 });
  });
  it('a hint or a wrong answer on a repeat is a Lapse, recorded once', () => {
    const lapsed = answer(start([item('e4'), item('c3')]), at(0), true);
    const repeat = answer(lapsed, at(0));
    const clock = clockOf(repeat, at(0));
    const hinted = hintReview(repeat.s, clock);
    expect(hinted.emit?.outcome).toBe('hint');
    expect(hintReview(hinted.state, clock).emit).toBeNull();
    expect(answerReview(hinted.state, 'a3', clock).emit).toBeNull();
    const wrong = answerReview(repeat.s, 'a3', clock);
    expect(wrong.emit?.outcome).toBe('lapse');
    expect(wrong.state.phase).toBe('replay');
    expect(wrong.state.repeats.map((x) => x.item.san)).toEqual(['e4']);
    expect(answerReview(wrong.state, 'e4', clock).emit).toBeNull();
  });
  it('a move that sticks does not come back; the session then ends', () => {
    const lapsed = answer(start([item('e4'), item('c3')]), at(0), true);
    const repeat = answer(lapsed, at(0));
    const later = (dueOf(repeat, 'e4') - T0.getTime()) / MINUTE;
    const d = answer(repeat, at(later));
    expect(dueOf(d, 'e4')).toBeGreaterThanOrEqual(DAY_END.getTime());
    expect(d.s.current).toBeNull();
    expect(d.s.repeats).toEqual([]);
    expect(reviewProgress(d.s)).toEqual({ done: 3, total: 3 });
  });
  it('a chained move is asked at once, before a due repeat (R-143)', () => {
    const lapsed = answer(
      start([item('c3'), item('e4'), item('Nf3')]),
      at(0),
      true,
    );
    expect(currentSan(lapsed)).toBe('e4');
    const d = answer(lapsed, at(30));
    expect(currentSan(d)).toBe('Nf3');
    expect(d.s.current?.reply?.san).toBe('e5');
    const after = answer(d, at(30));
    expect(currentSan(after)).toBe('c3');
    expect(after.s.current?.repeat).toBe(true);
  });
  it('a move still in its learning steps comes back at each step', () => {
    const items = [item('e4'), item('c3'), item('d3')];
    const lapsed = answer(start(items, 20, learning), at(0), true);
    expect(lapsed.s.repeats[0]?.due).toEqual(at(1));
    const first = answer(lapsed, at(1));
    expect(currentSan(first)).toBe('e4');
    const second = answer(first, at(1));
    expect(currentSan(second)).toBe('d3');
    expect(second.s.repeats[0]?.due).toEqual(at(11));
    const end = answer(second, at(2));
    expect(currentSan(end)).toBe('e4');
    expect(answer(end, at(11)).s.current).toBeNull();
  });
  it('asks the earliest due repeat first', () => {
    const one = answer(
      start([item('e4'), item('c3'), item('d3')]),
      at(0),
      true,
    );
    const two = answer(one, at(1), true);
    expect(two.s.repeats.map((r) => r.item.san)).toEqual(['e4', 'c3']);
    const d = answer(two, at(30));
    expect(currentSan(d)).toBe('e4');
    expect(answer(d, at(30)).s.current?.item.san).toBe('c3');
  });
  it('counts repeats toward the session size, leaving later moves for "continue" (R-62)', () => {
    const d = answer(
      start([item('e4'), item('c3'), item('d3')], 2),
      at(0),
      true,
    );
    expect(currentSan(d)).toBe('e4');
    expect(d.s.current?.repeat).toBe(true);
    expect(reviewProgress(d.s)).toEqual({ done: 1, total: 2 });
    const end = answer(d, at(30));
    expect(end.s.current).toBeNull();
    expect(reviewProgress(end.s)).toEqual({ done: 2, total: 2 });
    expect(end.s.outcomes.has(item('c3').key)).toBe(false);
  });
  it('does not chain past the session size', () => {
    const d = answer(
      start([item('e4'), item('Nf3'), item('c3')], 2),
      at(0),
      true,
    );
    expect(currentSan(d)).toBe('e4');
    expect(d.s.current?.repeat).toBe(true);
  });
  it('a size of zero asks nothing', () => {
    expect(start([item('e4')], 0).s.current).toBeNull();
  });
  it('does not repeat a move whose Review is due after the day ends', () => {
    const d = answer(start([item('e4'), item('c3')]), at(0));
    expect(d.s.repeats).toEqual([]);
    expect(reviewProgress(d.s)).toEqual({ done: 1, total: 2 });
  });
  it('drops a repeat a coach edit removed while drilling', () => {
    const lapsed = answer(start([item('e4'), item('c3')]), at(0), true);
    const edited = [{ id: 'r', graph: graph('1. Nf3 *'), active: true }];
    const right = answerReview(lapsed.s, 'c3', clockOf(lapsed, at(0))).state;
    const d = nextReview(right, edited, at(30));
    expect(d.current).toBeNull();
    expect(d.repeats).toEqual([]);
  });
  it('every session ends with nothing left due today, each answer in time order', () => {
    const items = ['e4', 'Nf3', 'Bc4', 'c3', 'd3'].map(item);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 15 })), {
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 8 }),
        (answers, size) => {
          let d = start(items, size);
          let minutes = 0;
          let steps = 0;
          const broken: string[] = [];
          while (d.s.current !== null && steps < 200) {
            const [wrong, wait] = answers[steps] ?? [false, 15];
            const now = at(minutes);
            minutes += wait;
            broken.push(...outOfTime(d.s, d.reviews, now));
            d = answer(d, now, wrong, at(minutes));
            steps += 1;
          }
          expect(broken).toEqual([]);
          expect(d.s.current).toBeNull();
          expect(d.s.asked).toBeGreaterThanOrEqual(
            Math.min(size, items.length),
          );
          for (const key of d.s.outcomes.keys()) {
            const due = d.reviews.get(key)?.fsrs.due.getTime() ?? NaN;
            expect(due).toBeGreaterThanOrEqual(DAY_END.getTime());
          }
        },
      ),
    );
  });
});
