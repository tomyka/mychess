import { describe, expect, it } from 'vitest';
import {
  BROADCAST_MONTH_RULES,
  BROADCAST_MONTH_PATTERN,
  BROADCAST_MONTH_REFUSALS,
  BROADCAST_MONTH_STATES,
  decideBroadcastFailure,
  decideBroadcastFinish,
  isBroadcastClaimHeld,
  broadcastMonthSchema,
  nextBroadcastMonthAction,
  searchMonths,
  decideBroadcastClaim,
  type BroadcastMonth,
  type BroadcastMonthState,
  type BroadcastMonthStatus,
} from './broadcast-month';

const months = (...given: string[]): BroadcastMonth[] =>
  given.map((month) => broadcastMonthSchema.parse(month));

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const now = new Date('2026-11-09T12:00:00Z');
const ago = (ms: number): Date => new Date(now.getTime() - ms);

/**
 * A month's status; a pending month keeps when its last attempt failed
 * (none by default), the others `since`.
 */
const status = (
  given: {
    readonly state?: BroadcastMonthState;
    readonly attempts?: number;
    readonly since?: Date;
    readonly lastFailedAt?: Date | null;
  } = {},
): BroadcastMonthStatus => {
  const {
    state = 'pending',
    attempts = 0,
    since = ago(DAY),
    lastFailedAt = null,
  } = given;
  return state === 'pending'
    ? { state, attempts, lastFailedAt }
    : { state, attempts, since };
};

describe('broadcast month rules (#316, R-183, spec decision 2)', () => {
  it('searches 12 months, retries a stale processing after 15 minutes, a failed attempt after 10 minutes (R-188) and a failed month after a day, three attempts', () => {
    expect(BROADCAST_MONTH_RULES).toEqual({
      searchMonths: 12,
      staleAfterMs: 15 * MINUTE,
      maxAttempts: 3,
      retryAfterFailureMs: 10 * MINUTE,
      failedRetryAfterMs: DAY,
    });
  });

  it('keys its refusals by message-catalogue key', () => {
    expect(BROADCAST_MONTH_REFUSALS).toEqual({
      claimLost: 'fide.monthClaimLost',
      notClaimable: 'fide.monthNotClaimable',
    });
  });

  it('has four states (spec decision 1)', () => {
    expect(BROADCAST_MONTH_STATES).toEqual([
      'pending',
      'processing',
      'done',
      'failed',
    ]);
  });
});

describe('broadcastMonthSchema', () => {
  it.each(['2025-01', '2026-12', '2026-10'])('accepts %j', (month) => {
    expect(broadcastMonthSchema.parse(month)).toBe(month);
  });

  it('holds no quote, so a check constraint can inline it', () => {
    expect(BROADCAST_MONTH_PATTERN).not.toContain("'");
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', ''])(
    'refuses %j',
    (month) => {
      expect(broadcastMonthSchema.safeParse(month).success).toBe(false);
    },
  );
});

describe('searchMonths (#316, R-183)', () => {
  const published = months(
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
    '2026-01',
  );

  it('takes the 12 newest published months, newest first', () => {
    expect(searchMonths(published)).toEqual(published.slice(2).reverse());
  });

  it('does not depend on the order of the list', () => {
    expect(searchMonths([...published].reverse())).toEqual(
      searchMonths(published),
    );
  });

  it('takes every month when fewer are published', () => {
    expect(searchMonths(months('2025-01', '2025-03', '2025-02'))).toEqual([
      '2025-03',
      '2025-02',
      '2025-01',
    ]);
  });

  it('counts a month listed twice once', () => {
    expect(searchMonths(months('2025-01', '2025-02', '2025-01'), 2)).toEqual([
      '2025-02',
      '2025-01',
    ]);
  });

  it('takes the n newest when asked for n', () => {
    expect(searchMonths(published, 3)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('gives nothing when nothing is published', () => {
    expect(searchMonths([])).toEqual([]);
  });

  it.each([0, -1, 1.5])('throws for a count of %d', (n) => {
    expect(() => searchMonths(published, n)).toThrow(RangeError);
  });
});

describe('nextBroadcastMonthAction (#316, spec decisions 2 and 3)', () => {
  it('uses a done month', () => {
    expect(
      nextBroadcastMonthAction(status({ state: 'done', attempts: 1 }), now),
    ).toBe('use');
  });

  it('processes a pending month', () => {
    expect(nextBroadcastMonthAction(status(), now)).toBe('process');
  });

  it('waits for a month another search is processing', () => {
    expect(
      nextBroadcastMonthAction(
        status({ state: 'processing', attempts: 1, since: ago(15 * MINUTE) }),
        now,
      ),
    ).toBe('wait');
  });

  it('waits after a processing month went stale, as after any failed attempt (R-188)', () => {
    expect(
      nextBroadcastMonthAction(
        status({
          state: 'processing',
          attempts: 2,
          since: ago(15 * MINUTE + 1),
        }),
        now,
      ),
    ).toBe('wait');
  });

  it('retries a stale processing month 10 minutes after it went stale', () => {
    expect(
      nextBroadcastMonthAction(
        status({ state: 'processing', attempts: 2, since: ago(25 * MINUTE) }),
        now,
      ),
    ).toBe('process');
  });

  it('waits for 10 minutes after a failed attempt (R-188)', () => {
    expect(
      nextBroadcastMonthAction(
        status({ attempts: 1, lastFailedAt: ago(10 * MINUTE - 1) }),
        now,
      ),
    ).toBe('wait');
  });

  it('retries a failed attempt once 10 minutes have passed (R-188)', () => {
    expect(
      nextBroadcastMonthAction(
        status({ attempts: 2, lastFailedAt: ago(10 * MINUTE) }),
        now,
      ),
    ).toBe('process');
  });

  it('counts a stale third attempt as the failure that fails the month', () => {
    expect(
      nextBroadcastMonthAction(
        status({ state: 'processing', attempts: 3, since: ago(DAY) }),
        now,
      ),
    ).toBe('unavailable');
  });

  it('retries a stale third attempt a day after it went stale', () => {
    expect(
      nextBroadcastMonthAction(
        status({
          state: 'processing',
          attempts: 3,
          since: ago(DAY + 15 * MINUTE),
        }),
        now,
      ),
    ).toBe('process');
  });

  it('leaves a failed month unavailable for a day', () => {
    expect(
      nextBroadcastMonthAction(
        status({ state: 'failed', attempts: 3, since: ago(DAY - 1) }),
        now,
      ),
    ).toBe('unavailable');
  });

  it('retries a failed month once a day has passed', () => {
    expect(
      nextBroadcastMonthAction(
        status({ state: 'failed', attempts: 4, since: ago(DAY) }),
        now,
      ),
    ).toBe('process');
  });
});

describe('decideBroadcastClaim (#316, spec decision 3)', () => {
  it('claims a pending month as one more attempt starting now', () => {
    expect(decideBroadcastClaim(status({ attempts: 1 }), now)).toEqual({
      ok: true,
      value: { state: 'processing', attempts: 2, since: now },
    });
  });

  it('claims a stale processing month', () => {
    expect(
      decideBroadcastClaim(
        status({ state: 'processing', attempts: 1, since: ago(DAY) }),
        now,
      ),
    ).toEqual({
      ok: true,
      value: { state: 'processing', attempts: 2, since: now },
    });
  });

  it('refuses a pending month whose last attempt failed under 10 minutes ago (R-188)', () => {
    expect(
      decideBroadcastClaim(
        status({ attempts: 1, lastFailedAt: ago(10 * MINUTE - 1) }),
        now,
      ),
    ).toEqual({ ok: false, refusal: { reason: 'fide.monthNotClaimable' } });
  });

  it.each([
    ['done', 1, ago(DAY)],
    ['processing', 1, ago(MINUTE)],
    ['failed', 3, ago(MINUTE)],
  ] as const)(
    'refuses a %s month with %d attempts it may not process',
    (state, attempts, since) => {
      expect(
        decideBroadcastClaim(status({ state, attempts, since }), now),
      ).toEqual({
        ok: false,
        refusal: { reason: 'fide.monthNotClaimable' },
      });
    },
  );
});

describe('decideBroadcastFailure (#316, spec decision 2)', () => {
  it.each([1, 2])(
    'leaves the month pending after failed attempt %d',
    (attempts) => {
      expect(
        decideBroadcastFailure(status({ state: 'processing', attempts }), now),
      ).toEqual({ state: 'pending', attempts, lastFailedAt: now });
    },
  );

  it.each([3, 4])('fails the month after failed attempt %d', (attempts) => {
    expect(
      decideBroadcastFailure(status({ state: 'processing', attempts }), now),
    ).toEqual({ state: 'failed', attempts, since: now });
  });

  it.each(['pending', 'done', 'failed'] as const)(
    'throws for a %s month: only a processing month can fail',
    (state) => {
      expect(() => decideBroadcastFailure(status({ state }), now)).toThrow(
        RangeError,
      );
    },
  );
});

describe('decideBroadcastFinish (#316, spec decision 2)', () => {
  it('marks a processing month done now', () => {
    expect(
      decideBroadcastFinish(status({ state: 'processing', attempts: 2 }), now),
    ).toEqual({ state: 'done', attempts: 2, since: now });
  });

  it.each(['pending', 'done', 'failed'] as const)(
    'throws for a %s month: only a processing month can finish',
    (state) => {
      expect(() => decideBroadcastFinish(status({ state }), now)).toThrow(
        RangeError,
      );
    },
  );
});

describe('isBroadcastClaimHeld (#316, spec decision 3)', () => {
  const claimedAt = ago(MINUTE);

  it('holds while the month is processing under the same claim', () => {
    expect(
      isBroadcastClaimHeld(
        status({ state: 'processing', attempts: 1, since: claimedAt }),
        new Date(claimedAt.getTime()),
      ),
    ).toBe(true);
  });

  it('is lost once a later claim took the stale month over', () => {
    expect(
      isBroadcastClaimHeld(
        status({ state: 'processing', attempts: 2, since: now }),
        claimedAt,
      ),
    ).toBe(false);
  });

  it.each(['pending', 'done', 'failed'] as const)(
    'is lost once the month is %s',
    (state) => {
      expect(
        isBroadcastClaimHeld(
          status({ state, attempts: 1, since: claimedAt }),
          claimedAt,
        ),
      ).toBe(false);
    },
  );
});
