import { act, renderHook } from '@testing-library/react';
import { START_KEY, startReview } from '@mychess/chess';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrainingData } from '../../lib/training-data';
import {
  answerMarks,
  startCore,
  type DrillCore,
  type Step,
} from './drill-core';
import { NOTHING_MORE } from './done-offer';
import { drillFrame } from './drill-frame';
import { FEEDBACK_MS, type DrillClock } from './drill-input';
import { useDrill, type DrillRules } from './use-drill';
import type { ResultSync } from './use-result-sync';

const NOW = new Date('2026-10-25T08:00:00Z');
const LONDON_ID = '00000000-0000-4000-8000-000000000001';

const data: TrainingData = {
  mode: 'learn',
  entries: [],
  others: [],
  reviews: [],
  tracked: [],
  knownWithoutLearning: [],
  learnedToday: 0,
  coachNotes: [],
  settings: { sessionSize: 20, newPerDay: 10, learnArrows: true },
  now: NOW,
};

/** A drill's state that a test can end. */
interface Fake extends DrillCore {
  readonly finished: boolean;
}

/** A drill that asks 1. d4 from the start until a test ends it. */
const RULES: DrillRules<Fake> = {
  start: ({ day }) => ({ ...startCore(day.reviews), finished: false }),
  frameOf: (s) =>
    drillFrame(
      {
        repertoireId: LONDON_ID,
        chapterId: undefined,
        key: START_KEY,
        last: undefined,
        playable: true,
        typeable: true,
      },
      s,
    ),
  play: (s, move) => ({
    state: { ...s, ...answerMarks(s, START_KEY, move, move.san === 'd4') },
    result: { kind: 'learned', moveKey: move.san, repertoireId: LONDON_ID },
  }),
  noticed: () => ({ move: undefined, holds: false }),
  answeredRight: () => false,
  onward: (s) => s,
  sliding: () => false,
  slid: (s) => s,
  isDone: (s) => s.finished,
  offer: ({ due }) => ({ ...NOTHING_MORE, continue: due, learn: true }),
};

function renderDrill() {
  const record = vi.fn<ResultSync['record']>();
  const sync: ResultSync = { record, unsynced: 0, retry: vi.fn() };
  let ids = 0;
  const clock: DrillClock = {
    now: () => new Date(Date.now()),
    newId: () => `id-${String(++ids)}`,
  };
  const hook = renderHook(() => useDrill(RULES, { data, sync, clock }));
  const drill = () => hook.result.current.drill;
  /** Takes `step` through the drill core, as a drill's own step. */
  const take = (step: (s: Fake) => Step<Fake>): void => {
    act(() => {
      hook.result.current.take(step);
    });
  };
  return { drill, record, take };
}

/** Types `san` into the drill's move field; whether it was taken. */
function type(drill: () => { onTyped: (t: string) => boolean }, san: string) {
  let taken = false;
  act(() => {
    taken = drill().onTyped(san);
  });
  return taken;
}

/** Lets `ms` of the drill's timers run. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the drill core', () => {
  it('records each step’s result with the clock’s id and time (R-60)', () => {
    const { drill, record } = renderDrill();
    wait(5);
    expect(type(drill, 'd4')).toBe(true);
    expect(record).toHaveBeenCalledExactlyOnceWith({
      resultId: 'id-1',
      kind: 'learned',
      moveKey: 'd4',
      repertoireId: LONDON_ID,
      answeredAt: new Date(NOW.getTime() + 5),
    });
  });

  it('ends a flash after the feedback time, 700ms, taking no move while a wrong one is held (#381)', () => {
    expect(FEEDBACK_MS).toBe(700);
    const { drill } = renderDrill();
    expect(type(drill, 'e4')).toBe(true);
    expect(drill().state.flash?.kind).toBe('wrong');
    expect(drill().view.dests.size).toBe(0);
    expect(type(drill, 'd4')).toBe(false);
    wait(FEEDBACK_MS - 1);
    expect(drill().state.flash).not.toBeNull();
    wait(1);
    expect(drill().state.flash).toBeNull();
    expect(drill().view.dests.size).toBeGreaterThan(0);
    expect(type(drill, 'd4')).toBe(true);
  });

  it('leaves a newer flash for its own time', () => {
    const { drill } = renderDrill();
    type(drill, 'd4');
    wait(200);
    type(drill, 'e4');
    const newer = drill().state.flash;
    wait(FEEDBACK_MS - 200);
    expect(drill().state.flash).toBe(newer);
    expect(drill().view.marked?.get('e4')).toBe('wrong');
    wait(200);
    expect(drill().state.flash).toBeNull();
  });

  it('puts a wrong move back on the board and marks an unknown typed move', () => {
    const { drill } = renderDrill();
    const revision = drill().view.revision;
    type(drill, 'e4');
    expect(drill().view.revision).toBe(revision + 1);
    expect(drill().state.unknownTyped).toBe(false);
    wait(FEEDBACK_MS);
    expect(type(drill, 'Zz9')).toBe(false);
    expect(drill().state.unknownTyped).toBe(true);
    act(() => {
      drill().onMove('e2', 'e5');
    });
    expect(drill().view.revision).toBe(revision + 2);
  });

  it('shows the side asked and where the day stands', () => {
    const { drill } = renderDrill();
    expect(drill().toMove).toBe('white');
    expect(drill().next).toBeNull();
    expect(drill().progress()).toMatchObject({ reviewed: 0, due: 0 });
    expect(drill().standing().kind).toBe('dayDone');
  });
});

describe('the drill core once done', () => {
  const D4_REVIEW = startReview('d4-key', new Date(0));

  it('reports the item by its ids, and offers nothing while the session runs', () => {
    const { drill } = renderDrill();
    expect(drill().item).toEqual({
      repertoireId: LONDON_ID,
      chapterId: undefined,
    });
    expect(drill().done).toBeNull();
  });

  it('offers the drill’s next steps once done', () => {
    const { drill, take } = renderDrill();
    take((s) => ({ state: { ...s, finished: true }, result: null }));
    expect(drill().done).toEqual({
      continue: false,
      review: false,
      learn: true,
    });
  });

  it('restarts from the training day with the drill’s Reviews, at a new revision', () => {
    const { drill, take, record } = renderDrill();
    const revision = drill().view.revision;
    take((s) => ({
      state: {
        ...s,
        finished: true,
        reviews: new Map([[D4_REVIEW.key, D4_REVIEW]]),
      },
      result: null,
    }));
    act(() => {
      drill().restart();
    });
    expect(drill().done).toBeNull();
    expect(drill().state.reviews.get(D4_REVIEW.key)).toBe(D4_REVIEW);
    expect(drill().view.revision).toBe(revision + 1);
    expect(record).not.toHaveBeenCalled();
  });
});
