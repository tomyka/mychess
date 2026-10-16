import { describe, expect, it } from 'vitest';
import { startReview } from './schedule';
import { learnStep, startLearn } from './training';

const now = new Date('2026-10-16T08:00:00Z');

describe('learn pass', () => {
  it('shows, then asks blind, then is learned on a correct answer', () => {
    let s = startLearn('k');
    expect(s).toEqual({ key: 'k', step: 'shown' });
    s = learnStep(s, 'seen', now);
    expect(s).toEqual({ key: 'k', step: 'asked' });
    s = learnStep(s, 'correct', now);
    expect(s).toEqual({
      key: 'k',
      step: 'learned',
      review: startReview('k', now),
    });
  });

  it('goes back to the arrow after a wrong blind answer', () => {
    const s = learnStep(learnStep(startLearn('k'), 'seen', now), 'wrong', now);
    expect(s).toEqual({ key: 'k', step: 'shown' });
  });

  it('ignores events that do not apply to the step', () => {
    const shown = startLearn('k');
    expect(learnStep(shown, 'correct', now)).toEqual(shown);
    expect(learnStep(shown, 'wrong', now)).toEqual(shown);
    const asked = learnStep(shown, 'seen', now);
    expect(learnStep(asked, 'seen', now)).toEqual(asked);
    const learned = learnStep(asked, 'correct', now);
    expect(learnStep(learned, 'wrong', now)).toEqual(learned);
    expect(learnStep(learned, 'seen', now)).toEqual(learned);
    expect(learnStep(learned, 'correct', now)).toEqual(learned);
  });
});
