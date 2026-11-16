import type { LichessBroadcastTour } from '@mychess/integrations';
import { describe, expect, it } from 'vitest';
import { tourCandidate, tourLastRoundAt } from './broadcast-candidate';

const TOUR: LichessBroadcastTour = {
  id: 'VilOpn26',
  name: 'Vilnius Open 2026',
  slug: 'vilnius-open-2026',
  official: false,
  createdAt: new Date('2026-09-20T09:00:00Z'),
  dates: {
    start: new Date('2026-10-01T09:00:00Z'),
    end: new Date('2026-10-05T09:00:00Z'),
  },
};

describe('a Lichess tour as the domain reads it (#349)', () => {
  it('takes its last round from Lichess’s last date', () => {
    expect(tourLastRoundAt(TOUR)).toEqual(new Date('2026-10-05T09:00:00Z'));
  });

  it('has no last round when Lichess gives no dates', () => {
    expect(tourLastRoundAt({ ...TOUR, dates: null })).toBeNull();
  });

  it('makes the candidate qualifyBroadcastTour reads', () => {
    expect(
      tourCandidate({ ...TOUR, official: true }, true, 'paulauskas'),
    ).toEqual({
      id: 'VilOpn26',
      name: 'Vilnius Open 2026',
      official: true,
      finished: true,
      lastRoundAt: new Date('2026-10-05T09:00:00Z'),
      organiser: 'paulauskas',
    });
    expect(
      tourCandidate({ ...TOUR, dates: null }, false, 'paulauskas').lastRoundAt,
    ).toBeNull();
  });
});
