import { describe, expect, it } from 'vitest';
import {
  broadcastMonthSchema,
  nextBroadcastMonthAction,
  type BroadcastMonthStatus,
} from './broadcast-month';
import {
  APPROVED_BROADCAST_ORGANISERS,
  BROADCAST_TOUR_ID_PATTERN,
  BROADCAST_TOUR_ORIGINS,
  BROADCAST_TOUR_REFUSALS,
  approvedOrganiser,
  broadcastRoundIdSchema,
  broadcastTourIdSchema,
  isGameOfTour,
  nextBroadcastTourAction,
  qualifyBroadcastTour,
  type BroadcastTourCandidate,
} from './broadcast-tour';
import type { BroadcastWindow } from './broadcast-window';

/** Dumps published up to 2025-12, the window from 2025-01. */
const WINDOW: BroadcastWindow = {
  oldest: broadcastMonthSchema.parse('2025-01'),
  newest: broadcastMonthSchema.parse('2025-12'),
};

const IN_DUMPS = new Date('2025-11-20T15:00:00Z');
const AFTER_DUMPS = new Date('2026-01-10T15:00:00Z');
const BEFORE_WINDOW = new Date('2024-12-31T15:00:00Z');
const NOW = new Date('2026-02-01T12:00:00Z');

/** A synthetic finished community tournament of an organiser. */
const candidate = (
  overrides: Partial<BroadcastTourCandidate> = {},
): BroadcastTourCandidate => ({
  id: 'Ab3dEf7h',
  name: 'Synthetic Open 2025',
  official: false,
  finished: true,
  lastRoundAt: IN_DUMPS,
  origin: { kind: 'organiser', organiser: 'paulauskas' },
  ...overrides,
});

const PASTED = { kind: 'pasted' } as const;

const roundId = (text: string) => broadcastRoundIdSchema.parse(text);

describe('APPROVED_BROADCAST_ORGANISERS (R-196, R-200)', () => {
  it('is the three accounts the owner approved', () => {
    expect(APPROVED_BROADCAST_ORGANISERS).toEqual([
      'vakarinis',
      'kesnor7',
      'paulauskas',
    ]);
  });
});

describe('BROADCAST_TOUR_ORIGINS', () => {
  it("is an organiser's list or a pasted link", () => {
    expect(BROADCAST_TOUR_ORIGINS).toEqual(['organiser', 'pasted']);
  });
});

describe('approvedOrganiser', () => {
  it('names an approved account, whatever its letter case', () => {
    expect(approvedOrganiser('kesnor7')).toBe('kesnor7');
    expect(approvedOrganiser('Paulauskas')).toBe('paulauskas');
  });

  it('is none for any other account', () => {
    expect(approvedOrganiser('someone')).toBeNull();
    expect(approvedOrganiser('')).toBeNull();
    expect(approvedOrganiser(' vakarinis')).toBeNull();
  });
});

describe('broadcastTourIdSchema', () => {
  it('takes eight letters or digits, the pattern the table checks', () => {
    expect(BROADCAST_TOUR_ID_PATTERN).toBe('^[A-Za-z0-9]{8}$');
    expect(broadcastTourIdSchema.parse('Ab3dEf7h')).toBe('Ab3dEf7h');
  });

  it.each(['Ab3dEf7', 'Ab3dEf7hX', 'Ab3d-f7h', 'Ab3dEf7\n', ''])(
    'refuses %j',
    (text) => {
      expect(broadcastTourIdSchema.safeParse(text).success).toBe(false);
      expect(broadcastRoundIdSchema.safeParse(text).success).toBe(false);
    },
  );

  it('shares its pattern with a round id, which is branded apart', () => {
    expect(broadcastRoundIdSchema.parse('Zx9yW8v7')).toBe('Zx9yW8v7');
  });
});

describe('qualifyBroadcastTour (#349, spec decision 2)', () => {
  it('keys its refusals by message-catalogue key', () => {
    expect(BROADCAST_TOUR_REFUSALS).toEqual({
      notFinished: 'fide.tourNotFinished',
      outsideWindow: 'fide.tourOutsideWindow',
      inDumps: 'fide.tourInDumps',
      claimLost: 'fide.tourClaimLost',
      notClaimable: 'fide.tourNotClaimable',
    });
  });

  it("queues an organiser's finished community tournament in the window (a)", () => {
    expect(qualifyBroadcastTour(candidate(), WINDOW, NOW)).toEqual({
      ok: true,
      value: {
        id: 'Ab3dEf7h',
        name: 'Synthetic Open 2025',
        official: false,
        lastRoundAt: IN_DUMPS,
        origin: { kind: 'organiser', organiser: 'paulauskas' },
      },
    });
  });

  it("queues an organiser's official tournament only once its last round is past the dumps (b)", () => {
    expect(
      qualifyBroadcastTour(candidate({ official: true }), WINDOW, NOW),
    ).toEqual({ ok: false, refusal: { reason: 'fide.tourInDumps' } });
    expect(
      qualifyBroadcastTour(
        candidate({ official: true, lastRoundAt: AFTER_DUMPS }),
        WINDOW,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('queues a pasted tournament, official or community, finished and in the window (c)', () => {
    for (const official of [true, false]) {
      expect(
        qualifyBroadcastTour(
          candidate({ official, origin: PASTED }),
          WINDOW,
          NOW,
        ).ok,
      ).toBe(true);
    }
  });

  it('refuses a tournament still running, from an organiser or pasted', () => {
    for (const origin of [candidate().origin, PASTED]) {
      expect(
        qualifyBroadcastTour(
          candidate({ finished: false, origin }),
          WINDOW,
          NOW,
        ),
      ).toEqual({ ok: false, refusal: { reason: 'fide.tourNotFinished' } });
    }
  });

  it('refuses a tournament whose last round is before the window', () => {
    for (const origin of [candidate().origin, PASTED]) {
      expect(
        qualifyBroadcastTour(
          candidate({ lastRoundAt: BEFORE_WINDOW, origin }),
          WINDOW,
          NOW,
        ),
      ).toEqual({ ok: false, refusal: { reason: 'fide.tourOutsideWindow' } });
    }
  });

  it('refuses a finished tournament without a last round date as outside the window', () => {
    expect(
      qualifyBroadcastTour(candidate({ lastRoundAt: null }), WINDOW, NOW),
    ).toEqual({ ok: false, refusal: { reason: 'fide.tourOutsideWindow' } });
  });

  it('says a running tournament is not finished before looking at its dates', () => {
    expect(
      qualifyBroadcastTour(
        candidate({ finished: false, lastRoundAt: null }),
        WINDOW,
        NOW,
      ),
    ).toEqual({ ok: false, refusal: { reason: 'fide.tourNotFinished' } });
  });

  it('throws for a tournament id the caller should have parsed', () => {
    expect(() =>
      qualifyBroadcastTour(candidate({ id: 'not-an-id' }), WINDOW, NOW),
    ).toThrow();
  });

  it('throws for a name the caller should have parsed', () => {
    expect(() =>
      qualifyBroadcastTour(candidate({ name: ' ' }), WINDOW, NOW),
    ).toThrow();
    expect(() =>
      qualifyBroadcastTour(candidate({ name: 'a\nb' }), WINDOW, NOW),
    ).toThrow();
  });

  it.each(['Open‮2025', 'Open​2025', '⁦Open'])(
    'throws for a name with a bidi or zero-width character (security L3): %j',
    (name) => {
      expect(() =>
        qualifyBroadcastTour(candidate({ name }), WINDOW, NOW),
      ).toThrow();
    },
  );

  it('refuses a last round after now as outside the window (security L2)', () => {
    for (const origin of [candidate().origin, PASTED]) {
      expect(
        qualifyBroadcastTour(
          candidate({ lastRoundAt: new Date(NOW.getTime() + 1), origin }),
          WINDOW,
          NOW,
        ),
      ).toEqual({ ok: false, refusal: { reason: 'fide.tourOutsideWindow' } });
    }
    expect(
      qualifyBroadcastTour(candidate({ lastRoundAt: NOW }), WINDOW, NOW).ok,
    ).toBe(true);
  });
});

describe('isGameOfTour (#349, security M1)', () => {
  const ROUNDS = [roundId('Zx9yW8v7'), roundId('Qr5sT6u7')];
  const url = (round: string, game = 'Gm1Gm2Gm') =>
    `https://lichess.org/broadcast/synthetic-open/round-1/${round}/${game}`;

  it("keeps a game of one of the tournament's own rounds", () => {
    expect(isGameOfTour(url('Zx9yW8v7'), ROUNDS)).toBe(true);
    expect(isGameOfTour(url('Qr5sT6u7'), ROUNDS)).toBe(true);
  });

  it.each([
    ['of another round', url('Ab3dEf7h')],
    ['without a game id', url('Zx9yW8v7').replace('/Gm1Gm2Gm', '')],
    ['with a short game id', url('Zx9yW8v7', 'Gm1Gm2G')],
    ['with a segment more', `${url('Zx9yW8v7')}/x`],
    ['of a plain Lichess game', 'https://lichess.org/Gm1Gm2Gm'],
    ['on another host', url('Zx9yW8v7').replace('lichess.org', 'evil.example')],
    ['over http', url('Zx9yW8v7').replace('https:', 'http:')],
  ])('drops a game %s', (_, link) => {
    expect(isGameOfTour(link, ROUNDS)).toBe(false);
  });

  it('drops every game of a tournament without rounds', () => {
    expect(isGameOfTour(url('Zx9yW8v7'), [])).toBe(false);
  });
});

describe('nextBroadcastTourAction (#349, CONTEXT: Broadcast tournament)', () => {
  it("is the month's next action, under a tournament's name", () => {
    expect(nextBroadcastTourAction).toBe(nextBroadcastMonthAction);
  });

  it('processes a queued tournament and uses a done one', () => {
    const queued: BroadcastMonthStatus = {
      state: 'pending',
      attempts: 0,
      lastFailedAt: null,
    };
    expect(nextBroadcastTourAction(queued, NOW)).toBe('process');
    expect(
      nextBroadcastTourAction({ state: 'done', attempts: 1, since: NOW }, NOW),
    ).toBe('use');
  });
});
