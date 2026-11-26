import { describe, expect, it } from 'vitest';
import { doneSteps, NOTHING_MORE } from './done-offer';

describe('doneSteps', () => {
  it('orders the steps offered Continue, Start review, Learn new moves, then Done', () => {
    const all = { continue: true, review: true, learn: true };
    expect(doneSteps(all)).toEqual(['continue', 'review', 'learn', 'finish']);
    expect(doneSteps({ ...all, continue: false })).toEqual([
      'review',
      'learn',
      'finish',
    ]);
    expect(doneSteps({ ...NOTHING_MORE, learn: true })).toEqual([
      'learn',
      'finish',
    ]);
  });

  it('offers only Done when nothing else is offered', () => {
    expect(doneSteps(NOTHING_MORE)).toEqual(['finish']);
  });
});
