import { describe, expect, it } from 'vitest';
import { learnStep, startLearn } from './learn';

describe('learn pass', () => {
  it('shows, then asks blind, then is learned on a correct answer', () => {
    let s = startLearn('k');
    expect(s).toEqual({ key: 'k', step: 'shown' });
    s = learnStep(s, 'seen');
    expect(s).toEqual({ key: 'k', step: 'asked' });
    s = learnStep(s, 'correct');
    expect(s).toEqual({ key: 'k', step: 'learned' });
  });

  it('goes back to the arrow after a wrong blind answer', () => {
    const s = learnStep(learnStep(startLearn('k'), 'seen'), 'wrong');
    expect(s).toEqual({ key: 'k', step: 'shown' });
  });

  it('ignores events that do not apply to the step', () => {
    const shown = startLearn('k');
    expect(learnStep(shown, 'correct')).toEqual(shown);
    expect(learnStep(shown, 'wrong')).toEqual(shown);
    const asked = learnStep(shown, 'seen');
    expect(learnStep(asked, 'seen')).toEqual(asked);
    const learned = learnStep(asked, 'correct');
    expect(learnStep(learned, 'wrong')).toEqual(learned);
    expect(learnStep(learned, 'seen')).toEqual(learned);
    expect(learnStep(learned, 'correct')).toEqual(learned);
  });
});
