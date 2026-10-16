import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from '../repertoire/graph';
import { lines } from '../repertoire/walk';
import { DAY_MS } from './schedule';
import {
  buildQueue,
  grade,
  knowThis,
  learnStep,
  mastered,
  startLearn,
  type ReviewState,
  type Scope,
} from './training';

const now = new Date('2026-10-16T08:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);

function graph(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** Two chapters: an Italian with a Philidor branch, and a Sicilian. */
const white = graph(
  '1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4 *\n\n1. e4 c5 2. Nf3 d6 3. d4 *',
  'white',
);
const [italian, sicilian] = white.chapters.map((c) => c.id).map(must);
const lineOf = (chapterId: string, index: number): RepertoireMove[] =>
  must(lines(white, chapterId)[index]);
const keyOfSan = (line: readonly RepertoireMove[], san: string) => {
  const move = must(line.find((m) => m.san === san));
  return moveKey(move.from, move.san);
};

/** Learns each key in a learn pass at `at`, as the player would. */
function learned(keys: readonly string[], at: Date): Map<string, ReviewState> {
  const reviews = new Map<string, ReviewState>();
  for (const k of keys) {
    const asked = learnStep(startLearn(k), 'seen', at);
    const done = learnStep(asked, 'correct', at);
    if (done.step !== 'learned') throw new Error('not learned');
    reviews.set(k, done.review);
  }
  return reviews;
}

describe('learn pass (R-55)', () => {
  it('schedules the first review for the next day once the move is learned', () => {
    const asked = learnStep(startLearn('k'), 'seen', now);
    const done = learnStep(asked, 'correct', now);
    expect(done.step).toBe('learned');
    if (done.step !== 'learned') return;
    expect(done.key).toBe('k');
    expect(done.review.key).toBe('k');
    expect(done.review.lapses).toEqual([]);
    expect(done.review.fsrs.due).toEqual(later(DAY_MS));
  });

  it('keeps the review of a learned move when more events arrive', () => {
    const done = learnStep(
      learnStep(startLearn('k'), 'seen', now),
      'correct',
      now,
    );
    expect(learnStep(done, 'wrong', later(DAY_MS))).toBe(done);
  });
});

describe('I know this (R-58)', () => {
  const italianMain = lineOf(must(italian), 0);

  it('puts a single move straight into review, due the next day', () => {
    const [review, ...rest] = knowThis(
      { kind: 'moves', keys: ['k'] },
      new Map(),
      now,
    );
    expect(rest).toEqual([]);
    expect(must(review).key).toBe('k');
    expect(must(review).fsrs.due).toEqual(later(DAY_MS));
    expect(must(review).lapses).toEqual([]);
  });

  it("puts a line's player moves into review, in line order", () => {
    const reviews = knowThis(
      { kind: 'line', graph: white, line: italianMain },
      new Map(),
      now,
    );
    expect(reviews.map((r) => r.key)).toEqual(
      ['e4', 'Nf3', 'Bc4'].map((san) => keyOfSan(italianMain, san)),
    );
  });

  it("puts a chapter's player moves into review, once each", () => {
    const reviews = knowThis(
      { kind: 'chapter', graph: white, chapterId: must(italian) },
      new Map(),
      now,
    );
    expect(reviews.map((r) => r.key.split('|')[1])).toEqual([
      'e4',
      'Nf3',
      'Bc4',
      'd4',
    ]);
  });

  it('leaves a move already in review with its state', () => {
    const e4 = keyOfSan(italianMain, 'e4');
    const existing = learned([e4], now);
    const reviews = knowThis(
      { kind: 'line', graph: white, line: italianMain },
      existing,
      later(DAY_MS),
    );
    expect(reviews.map((r) => r.key)).not.toContain(e4);
    expect(reviews).toHaveLength(2);
  });

  it('marks nothing for an unknown chapter or an empty line', () => {
    expect(
      knowThis(
        { kind: 'chapter', graph: white, chapterId: 'nope' },
        new Map(),
        now,
      ),
    ).toEqual([]);
    expect(
      knowThis({ kind: 'line', graph: white, line: [] }, new Map(), now),
    ).toEqual([]);
  });
});

describe('mastery of a line and a chapter (R-56)', () => {
  const italianMain = lineOf(must(italian), 0);
  const philidor = lineOf(must(italian), 1);
  const lineScope = (line: readonly RepertoireMove[]): Scope => ({
    kind: 'line',
    graph: white,
    line,
  });
  const chapterScope = (chapterId: string): Scope => ({
    kind: 'chapter',
    graph: white,
    chapterId,
  });
  const playerKeysOf = (line: readonly RepertoireMove[]) =>
    ['e4', 'Nf3', 'Bc4', 'd4']
      .filter((san) => line.some((m) => m.san === san))
      .map((san) => keyOfSan(line, san));

  it("masters a line when the player's moves of that line are recalled", () => {
    const reviews = learned(playerKeysOf(italianMain), now);
    expect(mastered(lineScope(italianMain), reviews, later(DAY_MS))).toBe(true);
    expect(mastered(lineScope(philidor), reviews, later(DAY_MS))).toBe(false);
  });

  it('masters a chapter only when every line of it is mastered', () => {
    const someLines = learned(playerKeysOf(italianMain), now);
    expect(
      mastered(chapterScope(must(italian)), someLines, later(DAY_MS)),
    ).toBe(false);
    const allLines = learned(
      [...playerKeysOf(italianMain), ...playerKeysOf(philidor)],
      now,
    );
    expect(mastered(chapterScope(must(italian)), allLines, later(DAY_MS))).toBe(
      true,
    );
  });

  it("does not need another chapter's moves", () => {
    const reviews = learned(
      [...playerKeysOf(italianMain), ...playerKeysOf(philidor)],
      now,
    );
    expect(mastered(chapterScope(must(sicilian)), reviews, later(DAY_MS))).toBe(
      false,
    );
    const sicilianLine = lineOf(must(sicilian), 0);
    const both = new Map([
      ...reviews,
      ...learned(
        [keyOfSan(sicilianLine, 'Nf3'), keyOfSan(sicilianLine, 'd4')],
        now,
      ),
    ]);
    expect(mastered(chapterScope(must(sicilian)), both, later(DAY_MS))).toBe(
      true,
    );
  });

  it('is lost when recall fades', () => {
    const reviews = learned(playerKeysOf(italianMain), now);
    expect(mastered(lineScope(italianMain), reviews, later(400 * DAY_MS))).toBe(
      false,
    );
  });

  it('is not mastered for an unknown chapter or an empty line', () => {
    const reviews = learned(
      [...playerKeysOf(italianMain), ...playerKeysOf(philidor)],
      now,
    );
    expect(mastered(chapterScope('nope'), reviews, now)).toBe(false);
    expect(mastered(lineScope([]), reviews, now)).toBe(false);
  });

  it('walks a transposing chapter, each move once', () => {
    const transposing = graph(
      '1. d4 Nf6 (1... e6 2. c4 Nf6 3. Nc3) 2. c4 e6 3. Nc3 *',
      'white',
    );
    const chapterId = must(transposing.chapters[0]).id;
    const scope: Scope = { kind: 'chapter', graph: transposing, chapterId };
    const reviews = knowThis(scope, new Map(), now);
    expect(reviews.map((r) => r.key.split('|')[1])).toEqual([
      'd4',
      'c4',
      'Nc3',
      'c4',
    ]);
    const all = new Map(reviews.map((r) => [r.key, r]));
    expect(mastered(scope, all, later(DAY_MS))).toBe(true);
  });
});

describe('same-day relearning (R-78)', () => {
  it('brings a lapsed move back into the queue within minutes', () => {
    const one = graph('1. e4 *', 'white');
    const e4 = moveKey(must(one.moves[0]).from, 'e4');
    const firstDue = later(DAY_MS);
    const review = must(learned([e4], now).get(e4));
    const lapsed = grade(review, 'hint', firstDue);
    const due = lapsed.fsrs.due.getTime();
    expect(due - firstDue.getTime()).toBeLessThan(3_600_000);
    const queueAt = (at: Date) =>
      buildQueue(
        {
          repertoires: [{ id: 'r', graph: one, active: true }],
          reviews: new Map([[e4, lapsed]]),
          learnedToday: 0,
        },
        at,
      );
    expect(queueAt(new Date(due))).toMatchObject({
      ok: true,
      value: {
        reviews: [{ key: e4, fromKey: must(one.moves[0]).from, san: 'e4' }],
      },
    });
    expect(queueAt(new Date(due - 1))).toMatchObject({
      ok: true,
      value: { reviews: [] },
    });
  });
});
