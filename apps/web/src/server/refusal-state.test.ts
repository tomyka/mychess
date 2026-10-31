import { describe, expect, it } from 'vitest';
import { refusalState } from './refusal-state';

describe('refusalState', () => {
  it('carries a limit refusal’s number', () => {
    expect(refusalState({ reason: 'repertoire.limit', limit: 50 })).toEqual({
      refusal: 'repertoire.limit',
      limit: 50,
    });
  });

  it('carries a plain refusal without one', () => {
    expect(refusalState({ reason: 'forkOffer.notOpen' })).toStrictEqual({
      refusal: 'forkOffer.notOpen',
    });
  });
});
