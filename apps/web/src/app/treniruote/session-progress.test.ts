import {
  moveKey,
  playerKeys,
  START_KEY,
  startReview,
  type ReviewState,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import { repertoireProgress } from './session-progress';

const NOW = new Date('2026-10-25T08:00:00Z');
const london = graphOf(LONDON);
const taimanov = graphOf(TAIMANOV, 'black');
const LONDON_KEYS = [...new Set(playerKeys(london))];
const D4 = moveKey(START_KEY, 'd4');

/** A Review of `key` due at `due`. */
function reviewDue(key: string, due: Date): ReviewState {
  const review = startReview(key, NOW);
  return { ...review, fsrs: { ...review.fsrs, due } };
}

const reviews = (...list: ReviewState[]) =>
  new Map(list.map((r) => [r.key, r]));

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('a repertoire’s progress after a session', () => {
  it('counts every held own move as to learn before any review', () => {
    expect(
      repertoireProgress([{ graph: london, active: true }], reviews(), NOW),
    ).toEqual({
      learned: 0,
      due: 0,
      toLearn: LONDON_KEYS.length,
      nextReview: null,
    });
  });

  it('counts reviewed moves as learned, the due ones among them as due', () => {
    const [, second = ''] = LONDON_KEYS;
    expect(
      repertoireProgress(
        [{ graph: london, active: true }],
        reviews(reviewDue(D4, at(-5)), reviewDue(second, at(90))),
        NOW,
      ),
    ).toEqual({
      learned: 2,
      due: 1,
      toLearn: LONDON_KEYS.length - 2,
      nextReview: at(90),
    });
  });

  it('gives the earliest review after now as the next one', () => {
    const [, second = '', third = ''] = LONDON_KEYS;
    expect(
      repertoireProgress(
        [{ graph: london, active: true }],
        reviews(
          reviewDue(D4, NOW),
          reviewDue(second, at(600)),
          reviewDue(third, at(30)),
        ),
        NOW,
      ).nextReview,
    ).toEqual(at(30));
  });

  it('leaves out paused repertoires and reviews of moves not held', () => {
    expect(
      repertoireProgress(
        [
          { graph: london, active: true },
          { graph: taimanov, active: false },
        ],
        reviews(reviewDue('elsewhere', at(10))),
        NOW,
      ),
    ).toEqual({
      learned: 0,
      due: 0,
      toLearn: LONDON_KEYS.length,
      nextReview: null,
    });
  });
});
