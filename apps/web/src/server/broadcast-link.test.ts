import {
  broadcastMonthSchema,
  type BroadcastMonth,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inMemoryLichessBroadcasts,
  type InMemoryLichessBroadcasts,
  type Scripted,
} from '../../test/fixtures/in-memory-lichess-broadcasts';
import type { FakeTour } from '../../test/fixtures/lichess-broadcast-api';
import { createAddBroadcastLink } from './broadcast-link';
import { fakeCounter } from '../../test/fixtures/count-request';

const NOW = new Date('2026-11-16T10:00:00Z');

/** The 12 newest dump months: 2025-10 to 2026-09. */
const PUBLISHED: BroadcastMonth[] = Array.from({ length: 14 }, (_, n) =>
  broadcastMonthSchema.parse(
    new Date(Date.UTC(2026, 8 - n, 1)).toISOString().slice(0, 7),
  ),
);

const TOUR: FakeTour = {
  id: 'VilOpn26',
  name: 'Vilnius Open 2026',
  dates: ['2026-10-01', '2026-10-05'],
  rounds: ['RoundAA1', 'RoundAA2'],
};

const TOUR_LINK = 'https://lichess.org/broadcast/vilnius-open-2026/VilOpn26';
const ROUND_LINK =
  'https://lichess.org/broadcast/vilnius-open-2026/round-2/RoundAA2/GameAAA1';

const counter = fakeCounter();
const counted = counter.calls;
const months = vi.fn<() => Promise<BroadcastMonth[]>>();
const add = vi.fn<(tour: QueuedBroadcastTour) => Promise<boolean>>();
const errors = vi.spyOn(console, 'error');

let lichess: InMemoryLichessBroadcasts;

/** The use case over `tour` as Lichess knows it; none without a token. */
function addBroadcastLink({
  tour = TOUR,
  script = {},
  token = true,
}: {
  tour?: FakeTour | null;
  script?: Readonly<Record<string, readonly Scripted[]>>;
  token?: boolean;
} = {}) {
  lichess = inMemoryLichessBroadcasts({
    tours: tour === null ? [] : [{ tour }],
    script,
  });
  return createAddBroadcastLink({
    count: counter.count,
    months,
    paste: token ? { broadcasts: lichess, add } : null,
  });
}

beforeEach(() => {
  counted.mockReset().mockResolvedValue('allowed');
  months.mockReset().mockResolvedValue(PUBLISHED);
  add.mockReset().mockResolvedValue(true);
  errors.mockReset().mockImplementation(() => undefined);
});

const paste = (
  raw: unknown,
  world: Parameters<typeof addBroadcastLink>[0] = {},
) => addBroadcastLink(world)('rokas', raw, NOW);

describe('adding a pasted Lichess broadcast (#349, R-197, spec decision 4)', () => {
  it('counts the link, asks for the tour, queues it as pasted and says it was added', async () => {
    expect(await paste(` ${TOUR_LINK} `)).toEqual({
      kind: 'added',
      name: 'Vilnius Open 2026',
    });
    expect(counted).toHaveBeenCalledExactlyOnceWith(
      'broadcast-link:rokas',
      { windowMs: 86_400_000, max: 10, reason: 'fide.tooManyBroadcastLinks' },
      NOW,
    );
    expect(lichess.calls).toEqual(['pasted VilOpn26']);
    expect(add).toHaveBeenCalledExactlyOnceWith({
      id: 'VilOpn26',
      name: 'Vilnius Open 2026',
      official: false,
      lastRoundAt: new Date('2026-10-05T09:00:00Z'),
      origin: { kind: 'pasted' },
    });
  });

  it('asks the gateway for the round a round link names', async () => {
    expect(await paste(ROUND_LINK)).toMatchObject({ kind: 'added' });
    expect(lichess.calls).toEqual(['pasted RoundAA2']);
  });

  it('says a tour already in the index was added already', async () => {
    add.mockResolvedValue(false);
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'known',
      name: 'Vilnius Open 2026',
    });
  });

  it.each([
    ['a link to another site', 'https://example.com/broadcast/x/VilOpn26'],
    ['text that is no link', 'Vilnius Open'],
    ['no text', undefined],
  ])('refuses %s, uncounted and before asking Lichess', async (_, raw) => {
    expect(await paste(raw)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkInvalid',
    });
    expect(counted).not.toHaveBeenCalled();
    expect(lichess.calls).toEqual([]);
  });

  it('refuses a link without a Lichess token as not available, uncounted', async () => {
    expect(await paste(TOUR_LINK, { token: false })).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
    expect(counted).not.toHaveBeenCalled();
  });

  it('refuses the 11th link of the day before asking Lichess', async () => {
    counted.mockResolvedValue('limited');
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.tooManyBroadcastLinks',
      limit: 10,
    });
    expect(lichess.calls).toEqual([]);
  });

  it.each([
    [
      'still running',
      { ...TOUR, running: ['RoundAA2'] },
      'fide.tourNotFinished',
    ],
    [
      'older than the window',
      { ...TOUR, dates: ['2025-08-01', '2025-08-05'] as const },
      'fide.tourOutsideWindow',
    ],
    [
      'without dates',
      { id: TOUR.id, name: TOUR.name, rounds: TOUR.rounds },
      'fide.tourOutsideWindow',
    ],
  ])('refuses a tour %s, queuing nothing', async (_, tour, refusal) => {
    expect(await paste(TOUR_LINK, { tour })).toEqual({
      kind: 'refused',
      refusal,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it.each([TOUR_LINK, ROUND_LINK])(
    'refuses %s Lichess does not know as not found',
    async (link) => {
      expect(await paste(link, { tour: null })).toEqual({
        kind: 'refused',
        refusal: 'fide.tourNotFound',
      });
    },
  );

  it.each([
    'lichessBroadcast.rateLimited',
    'lichessBroadcast.unavailable',
    'lichessBroadcast.unauthorized',
    'lichessBroadcast.invalid',
  ] as const)(
    'refuses as not available when the gateway answers %s (its 30 s deadline included)',
    async (reason) => {
      expect(
        await paste(TOUR_LINK, { script: { 'pasted VilOpn26': [reason] } }),
      ).toEqual({ kind: 'refused', refusal: 'fide.broadcastLinkUnavailable' });
    },
  );

  it('refuses as not available while no dump month is published', async () => {
    months.mockResolvedValue([]);
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
  });

  it('refuses as not available when something fails, logging no detail', async () => {
    add.mockRejectedValue(new Error(`insert failed: ${TOUR_LINK}`));
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'fide: broadcast link failed',
    );
  });
});
