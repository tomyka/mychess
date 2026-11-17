import { learnStart, playerKeys, toLearnCount } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { learnDayOf, type LearnScope } from './learn-scope';

const london = graphOf(LONDON);
const chapterId = london.chapters[0]?.id ?? '';
const scope: LearnScope = {
  tracked: [],
  learnedToday: 0,
  limits: { reviews: 20, newPerDay: 2 },
};

describe('learnDayOf (R-206)', () => {
  it('counts what learning the repertoire, a chapter or a line teaches today', () => {
    expect(toLearnCount(learnDayOf('r', london, scope))).toBe(2);
    expect(toLearnCount(learnDayOf('r', london, scope, { chapterId }))).toBe(2);
    expect(
      toLearnCount(learnDayOf('r', london, scope, { chapterId, lineIndex: 0 })),
    ).toBe(2);
  });

  it('counts nothing in a line or chapter the repertoire does not have', () => {
    expect(
      toLearnCount(
        learnDayOf('r', london, scope, { chapterId, lineIndex: 99 }),
      ),
    ).toBe(0);
    expect(
      toLearnCount(learnDayOf('r', london, scope, { chapterId: 'missing' })),
    ).toBe(0);
  });

  it('counts nothing once today’s new moves are used, though moves are left', () => {
    const used = learnDayOf(
      'r',
      london,
      { ...scope, learnedToday: 2 },
      { chapterId },
    );
    expect(toLearnCount(used)).toBe(0);
    expect(learnStart(used)).toEqual({ kind: 'limitReached' });
  });

  it('leaves out the moves the player already tracks', () => {
    const roomy = { reviews: 20, newPerDay: 1000 };
    const own = [...new Set(playerKeys(london))];
    const all = toLearnCount(
      learnDayOf('r', london, { ...scope, limits: roomy }),
    );
    expect(all).toBe(own.length);
    const known = learnDayOf('r', london, {
      tracked: own.slice(0, 1),
      learnedToday: 0,
      limits: roomy,
    });
    expect(toLearnCount(known)).toBe(all - 1);
  });
});
