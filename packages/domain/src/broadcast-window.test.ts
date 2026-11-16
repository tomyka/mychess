import { describe, expect, it } from 'vitest';
import { broadcastMonthSchema, type BroadcastMonth } from './broadcast-month';
import {
  broadcastWindow,
  broadcastPruneWindow,
  broadcastWindowStart,
  isBeforeBroadcastWindow,
  isAfterBroadcastDumps,
  isMonthBeforeBroadcastWindow,
  isWithinBroadcastWindow,
  monthOfInstant,
  tourListingDate,
} from './broadcast-window';

const months = (...given: string[]): BroadcastMonth[] =>
  given.map((month) => broadcastMonthSchema.parse(month));

/** 2024-11 to 2025-12: 14 published months, so the window drops two. */
const PUBLISHED = months(
  '2024-11',
  '2024-12',
  '2025-01',
  '2025-02',
  '2025-03',
  '2025-04',
  '2025-05',
  '2025-06',
  '2025-07',
  '2025-08',
  '2025-09',
  '2025-10',
  '2025-11',
  '2025-12',
);

const window = (): NonNullable<ReturnType<typeof broadcastWindow>> => {
  const found = broadcastWindow(PUBLISHED);
  if (found === null) throw new Error('no window');
  return found;
};

describe('broadcastWindow (#349, R-183, spec decision 2)', () => {
  it('spans the 12 newest published months, as the month index does', () => {
    expect(broadcastWindow(PUBLISHED)).toEqual({
      oldest: '2025-01',
      newest: '2025-12',
    });
  });

  it('is the one month when one is published', () => {
    expect(broadcastWindow(months('2025-03'))).toEqual({
      oldest: '2025-03',
      newest: '2025-03',
    });
  });

  it('is none while no month is published', () => {
    expect(broadcastWindow([])).toBeNull();
  });
});

describe('monthOfInstant', () => {
  it('is the UTC month, whatever the local time zone says', () => {
    expect(monthOfInstant(new Date('2025-01-31T23:30:00Z'))).toBe('2025-01');
    expect(monthOfInstant(new Date('2025-02-01T00:00:00Z'))).toBe('2025-02');
    expect(monthOfInstant(new Date('2025-01-31T23:30:00-02:00'))).toBe(
      '2025-02',
    );
  });
});

describe('broadcastWindowStart', () => {
  it('is the first instant of the oldest month, in UTC', () => {
    expect(broadcastWindowStart(window())).toEqual(
      new Date('2025-01-01T00:00:00Z'),
    );
  });
});

describe('isWithinBroadcastWindow', () => {
  it('holds from the first instant of the oldest month on', () => {
    expect(
      isWithinBroadcastWindow(new Date('2025-01-01T00:00:00Z'), window()),
    ).toBe(true);
    expect(
      isWithinBroadcastWindow(new Date('2024-12-31T23:59:59Z'), window()),
    ).toBe(false);
  });

  it('holds after the newest dump month too: the dumps lag behind', () => {
    expect(
      isWithinBroadcastWindow(new Date('2026-01-20T10:00:00Z'), window()),
    ).toBe(true);
  });
});

describe('isAfterBroadcastDumps', () => {
  it('holds only after the end of the newest dump month', () => {
    expect(
      isAfterBroadcastDumps(new Date('2025-12-31T23:59:59Z'), window()),
    ).toBe(false);
    expect(
      isAfterBroadcastDumps(new Date('2026-01-01T00:00:00Z'), window()),
    ).toBe(true);
  });
});

describe('isBeforeBroadcastWindow (#349, spec decision 3)', () => {
  it('holds only before the first instant of the oldest month', () => {
    expect(
      isBeforeBroadcastWindow(new Date('2024-12-31T23:59:59Z'), window()),
    ).toBe(true);
    expect(
      isBeforeBroadcastWindow(new Date('2025-01-01T00:00:00Z'), window()),
    ).toBe(false);
    expect(
      isBeforeBroadcastWindow(new Date('2026-01-20T10:00:00Z'), window()),
    ).toBe(false);
  });
});

describe('tourListingDate (#349, spec decision 3)', () => {
  const createdAt = new Date('2024-06-01T00:00:00Z');

  it("is a tour's last round when it has one", () => {
    const lastRoundAt = new Date('2025-03-02T10:00:00Z');
    expect(tourListingDate({ lastRoundAt, createdAt })).toBe(lastRoundAt);
  });

  it('is when the tour was created when it has no dates', () => {
    expect(tourListingDate({ lastRoundAt: null, createdAt })).toBe(createdAt);
  });
});

describe('broadcastPruneWindow (#344)', () => {
  /** In the month after the newest published one, as the dumps lag. */
  const NOW = new Date('2026-01-20T10:00:00Z');

  it('is the search window once 12 months are published', () => {
    expect(broadcastPruneWindow(PUBLISHED, NOW)).toEqual({
      oldest: '2025-01',
      newest: '2025-12',
    });
    expect(broadcastPruneWindow(PUBLISHED.slice(-12), NOW)).toEqual({
      oldest: '2025-01',
      newest: '2025-12',
    });
  });

  it('is none with fewer than 12 published months, so a short list prunes nothing', () => {
    expect(broadcastPruneWindow(PUBLISHED.slice(-11), NOW)).toBeNull();
    expect(broadcastPruneWindow([], NOW)).toBeNull();
  });

  it('counts each month once', () => {
    const repeated = [...PUBLISHED.slice(-11), ...PUBLISHED.slice(-11)];
    expect(broadcastPruneWindow(repeated, NOW)).toBeNull();
  });

  it('is none for a list naming a month after the current one (security Low 1)', () => {
    const future = [...PUBLISHED, ...months('2099-01')];
    expect(broadcastPruneWindow(future, NOW)).toBeNull();
    expect(
      broadcastPruneWindow(PUBLISHED, new Date('2025-12-31T23:59:59Z')),
    ).not.toBeNull();
    expect(
      broadcastPruneWindow(PUBLISHED, new Date('2025-11-30T23:59:59Z')),
    ).toBeNull();
  });

  it('is none for a stale list, whose newest month is over 3 months old (security Low 1)', () => {
    expect(
      broadcastPruneWindow(PUBLISHED, new Date('2026-03-31T23:59:59Z')),
    ).not.toBeNull();
    expect(
      broadcastPruneWindow(PUBLISHED, new Date('2026-04-01T00:00:00Z')),
    ).toBeNull();
  });
});

describe('isMonthBeforeBroadcastWindow (#344)', () => {
  it('holds only for months before the oldest one', () => {
    const [before, oldest, newest] = months('2024-12', '2025-01', '2025-12');
    if (before === undefined || oldest === undefined || newest === undefined) {
      throw new Error('months');
    }
    expect(isMonthBeforeBroadcastWindow(before, window())).toBe(true);
    expect(isMonthBeforeBroadcastWindow(oldest, window())).toBe(false);
    expect(isMonthBeforeBroadcastWindow(newest, window())).toBe(false);
  });
});
