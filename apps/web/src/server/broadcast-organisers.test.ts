import {
  broadcastMonthSchema,
  type ApprovedOrganiser,
  type BroadcastWindow,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inMemoryLichessBroadcasts,
  type InMemoryWorld,
} from '../../test/fixtures/in-memory-lichess-broadcasts';
import type { FakeTour } from '../../test/fixtures/lichess-broadcast-api';
import { listOrganiserTours } from './broadcast-organisers';

const NOW = new Date('2026-11-16T03:00:00Z');

/** The dumps reach 2026-09; the window starts 2025-10. */
const WINDOW: BroadcastWindow = {
  oldest: broadcastMonthSchema.parse('2025-10'),
  newest: broadcastMonthSchema.parse('2026-09'),
};

const tour = (
  id: string,
  last: string,
  over: Partial<FakeTour> = {},
): FakeTour => ({
  id,
  name: `Tour ${id}`,
  dates: [last, last],
  rounds: ['RoundAA1'],
  ...over,
});

const COMMUNITY = tour('Commun01', '2026-10-05');
const OFFICIAL_NEW = tour('Offici01', '2026-10-20', { official: true });
const OFFICIAL_IN_DUMPS = tour('Offici02', '2026-08-01', { official: true });
const RUNNING = tour('Runnin01', '2026-11-15', { running: ['RoundAA1'] });
const OLD = tour('OldTour1', '2025-06-01');

const page = (n: number, organiser: ApprovedOrganiser = 'vakarinis') =>
  `page ${organiser} ${String(n)}`;

const queued: QueuedBroadcastTour[] = [];
const queue = vi.fn((queuedTour: QueuedBroadcastTour) => {
  queued.push(queuedTour);
  return Promise.resolve(true);
});
const warnings = vi.spyOn(console, 'warn');

beforeEach(() => {
  queued.length = 0;
  queue.mockClear();
  warnings.mockReset().mockImplementation(() => undefined);
});

async function list(world: InMemoryWorld) {
  const broadcasts = inMemoryLichessBroadcasts(world);
  const listing = await listOrganiserTours({ broadcasts, queue }, WINDOW, NOW);
  return { listing, calls: broadcasts.calls };
}

describe('the nightly organiser listing (#349, spec decisions 2 and 3)', () => {
  it('lists every approved organiser and queues the finished tours that qualify', async () => {
    const { listing, calls } = await list({
      organisers: {
        vakarinis: [[RUNNING, OFFICIAL_NEW, COMMUNITY, OFFICIAL_IN_DUMPS]],
      },
    });
    expect(calls).toEqual([page(1), page(1, 'kesnor7'), page(1, 'paulauskas')]);
    expect(queued).toEqual([
      expect.objectContaining({
        id: OFFICIAL_NEW.id,
        name: 'Tour Offici01',
        official: true,
        lastRoundAt: new Date('2026-10-20T09:00:00Z'),
        organiser: 'vakarinis',
      }),
      expect.objectContaining({ id: COMMUNITY.id, official: false }),
    ]);
    expect(listing).toEqual({ queued: 2, stopped: false });
  });

  it('counts only the tours that were new to the index', async () => {
    queue.mockImplementationOnce(() => Promise.resolve(false));
    const { listing } = await list({
      organisers: { vakarinis: [[OFFICIAL_NEW, COMMUNITY]] },
    });
    expect(queue).toHaveBeenCalledTimes(2);
    expect(listing.queued).toBe(1);
  });

  it('reads further pages until a page holds only tours older than the window', async () => {
    const { calls } = await list({
      organisers: {
        vakarinis: [[COMMUNITY], [OLD, COMMUNITY], [OLD], [COMMUNITY]],
      },
    });
    expect(calls.slice(0, 3)).toEqual([page(1), page(2), page(3)]);
    expect(calls).not.toContain(page(4));
  });

  it('stops paging on the last page', async () => {
    const { calls } = await list({ organisers: { vakarinis: [[COMMUNITY]] } });
    expect(calls.filter((call) => call.includes('vakarinis'))).toEqual([
      page(1),
    ]);
  });

  // The gateway holds the next request a minute after a 429.
  it('asks again after a 429', async () => {
    const { listing, calls } = await list({
      organisers: { vakarinis: [[COMMUNITY]] },
      script: { [page(1)]: ['lichessBroadcast.rateLimited', 'world'] },
    });
    expect(calls).toEqual([
      page(1),
      page(1),
      page(1, 'kesnor7'),
      page(1, 'paulauskas'),
    ]);
    expect(listing).toEqual({ queued: 1, stopped: false });
  });

  it('stops for the night on a second 429', async () => {
    const { listing, calls } = await list({
      organisers: { vakarinis: [[COMMUNITY]] },
      script: {
        [page(1)]: ['lichessBroadcast.rateLimited', 'world'],
        [page(1, 'kesnor7')]: ['lichessBroadcast.rateLimited'],
      },
    });
    expect(calls).toEqual([page(1), page(1), page(1, 'kesnor7')]);
    expect(listing).toEqual({ queued: 1, stopped: true });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser listing stopped for the night on a second 429',
    );
  });

  it('logs an organiser Lichess refuses by the refusal and goes on to the next', async () => {
    const { listing, calls } = await list({
      organisers: { kesnor7: [[COMMUNITY]] },
      script: { [page(1)]: ['lichessBroadcast.notFound'] },
    });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser vakarinis not listed',
      'lichessBroadcast.notFound',
    );
    expect(calls).toHaveLength(3);
    expect(listing.queued).toBe(1);
  });

  it('logs an organiser whose listing fails, never its error text, and goes on', async () => {
    queue.mockRejectedValueOnce(new TypeError('insert failed: Tour Commun01'));
    const { listing } = await list({
      organisers: { vakarinis: [[COMMUNITY]], kesnor7: [[COMMUNITY]] },
    });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser vakarinis not listed',
      'TypeError',
    );
    expect(listing.queued).toBe(1);
  });
});
