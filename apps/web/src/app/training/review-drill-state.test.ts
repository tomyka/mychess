import {
  answerReview,
  dueReviews,
  playerKeys,
  reviewProgress,
  startReview,
  type BoardMove,
  type ReviewState,
  type TrainingRepertoire,
} from '@mychess/chess';
import { dayEnd } from '@mychess/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { graphOf, pgnWithMoves } from '../../../test/fixtures/repertoires';
import {
  advanced,
  afterAnswer,
  answeredMove,
  isDone,
  isRepeat,
  sessionCounts,
  startDrill,
  type DrillState,
} from './review-drill-state';

/** The session's progress, as the review panel's counter shows it. */
const progress = (s: DrillState) => reviewProgress(s.session);

const NOW = new Date('2026-10-25T08:00:00Z');
/** 23:59 in Vilnius: a Lapse's 1-minute step falls due exactly at midnight. */
const MINUTE_TO_MIDNIGHT = new Date('2026-10-25T21:59:00Z');
const DAY = 86_400_000;
/** The clock the drill answers at; NOW unless a test moves it. */
let at = NOW;
/** One White move, every Black reply, one White move after each: 21 own moves. */
const WIDE: TrainingRepertoire = {
  id: 'wide',
  graph: graphOf(pgnWithMoves(41)),
  active: true,
};
const REPERTOIRES = [WIDE];

/** Every own move of WIDE, due since two days before NOW. */
const dueEverything = (): ReadonlyMap<string, ReviewState> =>
  new Map(
    playerKeys(WIDE.graph).map((key) => [
      key,
      startReview(key, new Date(at.getTime() - 3 * DAY)),
    ]),
  );

/** A drill over the session-size's worth of due moves. */
function drill(size: number): DrillState {
  const day = {
    repertoires: REPERTOIRES,
    reviews: dueEverything(),
    knownWithoutLearning: new Set<string>(),
    learnedToday: 0,
    limits: { reviews: size, newPerDay: 0 },
  };
  return startDrill(dueReviews(day, at), REPERTOIRES, day.reviews, {
    size,
    dayEnd: dayEnd(at),
  });
}

const MOVE: BoardMove = { orig: 'a1', dest: 'a2', san: 'x', promotion: null };

/** Plays `san` for the current item, then lets the drill go on. */
function play(s: DrillState, san: string): DrillState {
  const answered = afterAnswer(
    s,
    MOVE,
    answerReview(s.session, san, { now: at, reviews: s.reviews }),
  );
  return answered.session.phase === 'correct'
    ? advanced(answered, REPERTOIRES, at)
    : answered;
}

/** The current item's move. */
function expected(s: DrillState): string {
  const san = s.session.current?.item.san;
  if (san === undefined) throw new Error('the drill asks nothing');
  return san;
}

/** Answers right until the drill is done or `stop` holds. */
function passUntil(s: DrillState, stop: (s: DrillState) => boolean) {
  let state = s;
  for (let i = 0; i < 50 && !isDone(state) && !stop(state); i++)
    state = play(state, expected(state));
  return state;
}

/** A lapse on the current item, then its move played after the arrow. */
function lapse(s: DrillState): DrillState {
  return play(play(s, 'wrong'), expected(s));
}

beforeEach(() => {
  at = NOW;
});

describe('the review drill state', () => {
  it('asks every due move of a session once when each is right', () => {
    const start = drill(10);
    expect(progress(start)).toEqual({ done: 0, total: 10 });
    const done = passUntil(start, () => false);
    expect(isDone(done)).toBe(true);
    expect(progress(done)).toEqual({ done: 10, total: 10 });
    expect(sessionCounts(done)).toEqual({
      kind: 'review',
      reviewed: 10,
      passed: 10,
      lapses: 0,
    });
  });

  it('asks a lapsed move again once its relearning step runs out (R-78, #338)', () => {
    const start = drill(10);
    const missed = start.session.current?.item.key;
    const afterLapse = lapse(start);
    // Inside its 1-minute step the next due moves are asked instead.
    const inside = play(afterLapse, expected(afterLapse));
    expect(isRepeat(afterLapse) || isRepeat(inside)).toBe(false);
    at = new Date(NOW.getTime() + 2 * 60_000);
    const repeat = play(inside, expected(inside));
    expect(isRepeat(repeat)).toBe(true);
    expect(repeat.session.current?.item.key).toBe(missed);
    // Two moves finished; the missed one is owed its repeat (R-223).
    expect(progress(repeat)).toEqual({ done: 2, total: 10 });
  });

  it('asks a lapsed move again at the end when the clock stands still, until it no longer comes back today (R-78)', () => {
    const start = drill(10);
    const missed = start.session.current?.item.key;
    const afterLapse = lapse(start);
    // The repeat takes no slot (R-223): all ten moves are asked.
    expect(progress(afterLapse)).toEqual({ done: 0, total: 10 });
    const repeat = passUntil(afterLapse, isRepeat);
    expect(progress(repeat).done).toBe(9);
    expect(repeat.session.current?.item.key).toBe(missed);
    const done = passUntil(repeat, () => false);
    expect(isDone(done)).toBe(true);
    const due = done.reviews.get(missed ?? '')?.fsrs.due;
    expect(due?.getTime()).toBeGreaterThanOrEqual(dayEnd(NOW).getTime());
    // The summary counts moves: the first answer of each.
    expect(sessionCounts(done)).toEqual({
      kind: 'review',
      reviewed: 10,
      passed: 9,
      lapses: 1,
    });
    const { done: asked, total } = progress(done);
    expect(asked).toBe(10);
    expect(total).toBe(10);
  });

  it('asks a move missed again on its repeat once more', () => {
    const start = drill(10);
    const repeat = passUntil(lapse(start), isRepeat);
    const again = lapse(repeat);
    expect(isRepeat(again)).toBe(true);
    expect(again.session.current?.item.key).toBe(
      repeat.session.current?.item.key,
    );
    expect(sessionCounts(again)).toMatchObject({ reviewed: 10, lapses: 1 });
  });

  it('is not a repeat at the start', () => {
    expect(isRepeat(drill(10))).toBe(false);
  });

  it('asks a move missed a minute to midnight again, though its step lands tomorrow (R-215)', () => {
    at = MINUTE_TO_MIDNIGHT;
    const start = drill(10);
    const missed = start.session.current?.item.key ?? '';
    const afterLapse = lapse(start);
    expect(
      afterLapse.reviews.get(missed)?.fsrs.due.getTime(),
    ).toBeGreaterThanOrEqual(dayEnd(at).getTime());
    const repeat = passUntil(afterLapse, isRepeat);
    expect(repeat.session.current?.item.key).toBe(missed);
    const done = passUntil(repeat, () => false);
    expect(isDone(done)).toBe(true);
    const { done: asked, total } = progress(done);
    expect(asked).toBe(total);
  });

  it('has no answered move once done', () => {
    const done = passUntil(drill(10), () => false);
    expect(isDone(done)).toBe(true);
    expect(answeredMove(done)).toBeUndefined();
  });
});
