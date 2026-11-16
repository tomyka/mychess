import { describe, expect, it } from 'vitest';
import { forkOriginOf } from './fork-origin';

const SOURCE = '00000000-0000-4000-8000-000000000001';

describe('forkOriginOf (#328)', () => {
  it('is the source repertoire and the coach name a fork recorded', () => {
    expect(forkOriginOf({ repertoireId: SOURCE, coachName: 'Jonas' })).toEqual({
      repertoireId: SOURCE,
      coachName: 'Jonas',
    });
  });

  it('keeps the coach name once the source repertoire is deleted (R-49, R-131)', () => {
    expect(forkOriginOf({ repertoireId: null, coachName: 'Jonas' })).toEqual({
      repertoireId: null,
      coachName: 'Jonas',
    });
  });

  it('is none for a repertoire that recorded no coach: not a fork, or forked before #328', () => {
    expect(forkOriginOf({ repertoireId: null, coachName: null })).toBeNull();
  });
});
