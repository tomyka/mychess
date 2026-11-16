import type { BroadcastTourEntry } from '@mychess/db';
import {
  broadcastMonthSchema,
  broadcastTourIdSchema,
  qualifyBroadcastTour,
  type BroadcastTourStatus,
  type BroadcastWindow,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inMemoryLichessBroadcasts,
  type InMemoryWorld,
} from '../../test/fixtures/in-memory-lichess-broadcasts';
import { createCommunityBroadcasts } from './broadcast-community';

const NOW = new Date('2026-11-16T03:00:00Z');
const WINDOW: BroadcastWindow = {
  oldest: broadcastMonthSchema.parse('2025-10'),
  newest: broadcastMonthSchema.parse('2026-09'),
};
const HOUR = 60 * 60_000;

const id = (text: string) => broadcastTourIdSchema.parse(text);

const entry = (
  tourId: string,
  status: BroadcastTourStatus,
): BroadcastTourEntry => ({
  tourId: id(tourId),
  name: `Tour ${tourId}`,
  official: false,
  lastRoundAt: new Date('2026-10-05T09:00:00Z'),
  status,
});

const PASTED = (() => {
  const qualified = qualifyBroadcastTour(
    {
      id: 'Pasted01',
      name: 'Pasted Open',
      official: false,
      finished: true,
      lastRoundAt: new Date('2026-10-05T09:00:00Z'),
      origin: { kind: 'pasted' },
    },
    WINDOW,
    NOW,
  );
  if (!qualified.ok) throw new Error('the fixture tour does not qualify');
  return qualified.value;
})();

const deps = {
  queue: vi.fn<(tour: QueuedBroadcastTour) => Promise<boolean>>(),
  statuses: vi.fn<(window: BroadcastWindow) => Promise<BroadcastTourEntry[]>>(),
  needTours: vi.fn<(tourIds: readonly string[]) => void>(),
};
const errors = vi.spyOn(console, 'error');

beforeEach(() => {
  deps.queue.mockReset().mockResolvedValue(true);
  deps.statuses.mockReset().mockResolvedValue([]);
  deps.needTours.mockReset();
  errors.mockReset().mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function community(world: InMemoryWorld = {}) {
  return createCommunityBroadcasts({
    broadcasts: inMemoryLichessBroadcasts(world),
    runner: { needTours: deps.needTours },
    queue: deps.queue,
    statuses: deps.statuses,
  });
}

describe('the community broadcasts (#349)', () => {
  it('list the organisers at night, then hand every tour due to the runner', async () => {
    deps.statuses.mockResolvedValue([
      entry('Pending1', { state: 'pending', attempts: 0, lastFailedAt: null }),
      entry('DoneTour', { state: 'done', attempts: 1, since: NOW }),
      entry('Retried1', {
        state: 'failed',
        attempts: 3,
        since: new Date(NOW.getTime() - 25 * HOUR),
      }),
      entry('FailedTd', { state: 'failed', attempts: 3, since: NOW }),
    ]);
    const broadcasts = community({
      organisers: { vakarinis: [[]] },
    });
    expect(broadcasts.nightly(WINDOW, NOW)).toBe('started');
    await broadcasts.settled();
    expect(deps.statuses).toHaveBeenCalledExactlyOnceWith(WINDOW);
    expect(deps.needTours).toHaveBeenCalledExactlyOnceWith([
      'Pending1',
      'Retried1',
    ]);
  });

  it('run one night at a time', async () => {
    const broadcasts = community();
    expect(broadcasts.nightly(WINDOW, NOW)).toBe('started');
    expect(broadcasts.nightly(WINDOW, NOW)).toBe('running');
    await broadcasts.settled();
    expect(deps.statuses).toHaveBeenCalledOnce();
    expect(broadcasts.nightly(WINDOW, NOW)).toBe('started');
    await broadcasts.settled();
    expect(deps.statuses).toHaveBeenCalledTimes(2);
  });

  it('log a night that failed by its error name alone, and can run again', async () => {
    deps.statuses.mockRejectedValueOnce(
      new TypeError('a text naming anything'),
    );
    const broadcasts = community();
    broadcasts.nightly(WINDOW, NOW);
    await broadcasts.settled();
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'fide: community broadcasts night failed',
      'TypeError',
    );
    expect(broadcasts.nightly(WINDOW, NOW)).toBe('started');
  });

  it('queue an added tour and hand it to the runner when it is new', async () => {
    const broadcasts = community();
    expect(await broadcasts.add(PASTED)).toBe(true);
    expect(deps.queue).toHaveBeenCalledExactlyOnceWith(PASTED);
    expect(deps.needTours).toHaveBeenCalledExactlyOnceWith(['Pasted01']);
  });

  it('leave a tour already queued to the index as it is', async () => {
    deps.queue.mockResolvedValue(false);
    const broadcasts = community();
    expect(await broadcasts.add(PASTED)).toBe(false);
    expect(deps.needTours).not.toHaveBeenCalled();
  });
});
