import { describe, expect, it } from 'vitest';
import { broadcastMonthSchema, type BroadcastMonth } from './broadcast-month';
import {
  broadcastWindow,
  broadcastWindowStart,
  isAfterBroadcastDumps,
  isWithinBroadcastWindow,
  monthOfInstant,
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
