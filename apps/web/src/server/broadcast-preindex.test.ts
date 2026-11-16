import type { BroadcastMonthEntry } from '@mychess/db';
import {
  broadcastMonthSchema,
  type BroadcastMonth,
  type BroadcastMonthStatus,
  type BroadcastWindow,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreindex } from './broadcast-preindex';

const NOW = new Date('2026-11-10T03:00:00Z');
const MINUTE = 60_000;

const month = (text: string): BroadcastMonth =>
  broadcastMonthSchema.parse(text);

/** The 14 months Lichess lists: 2025-09 to 2026-10, oldest first. */
const LISTED = Array.from({ length: 14 }, (_, n) =>
  month(new Date(Date.UTC(2025, 8 + n, 1)).toISOString().slice(0, 7)),
);
const NEWEST = [...LISTED].reverse().slice(0, 12);
const at = (n: number): BroadcastMonth => {
  const found = NEWEST[n];
  if (found === undefined) throw new Error(`no month ${String(n)}`);
  return found;
};

const months = vi.fn<() => Promise<BroadcastMonth[]>>();
const monthStatuses =
  vi.fn<
    (months: readonly BroadcastMonth[]) => Promise<BroadcastMonthEntry[]>
  >();
const need = vi.fn<(months: readonly BroadcastMonth[]) => void>();
const nightly =
  vi.fn<(window: BroadcastWindow, now: Date) => 'started' | 'running'>();
const warnings = vi.spyOn(console, 'warn');

/** The months' entries with `statuses` by month, pending otherwise. */
function entries(
  statuses: ReadonlyMap<string, BroadcastMonthStatus>,
): (wanted: readonly BroadcastMonth[]) => Promise<BroadcastMonthEntry[]> {
  return (wanted) =>
    Promise.resolve(
      wanted.map((m) => ({
        month: m,
        status: statuses.get(m) ?? {
          state: 'pending',
          attempts: 0,
          lastFailedAt: null,
        },
      })),
    );
}

const preindex = (community = true) =>
  createPreindex({
    months,
    monthStatuses,
    runner: { need },
    community: community ? { nightly } : null,
  });

beforeEach(() => {
  months.mockReset().mockResolvedValue(LISTED);
  monthStatuses.mockReset().mockImplementation(entries(new Map()));
  need.mockReset();
  nightly.mockReset().mockReturnValue('started');
  warnings.mockReset().mockImplementation(() => undefined);
});

describe('the nightly upkeep of the broadcast index (#354, R-195; #349)', () => {
  it('hands every one of the 12 newest months still to index to the runner, and starts the community night', async () => {
    expect(await preindex()(NOW)).toEqual({
      queued: 12,
      ready: 0,
      community: 'started',
    });
    expect(monthStatuses).toHaveBeenCalledExactlyOnceWith(NEWEST);
    expect(need).toHaveBeenCalledExactlyOnceWith(NEWEST);
    expect(nightly).toHaveBeenCalledExactlyOnceWith(
      { oldest: '2025-11', newest: '2026-10' },
      NOW,
    );
  });

  it('hands only the months whose next action is process', async () => {
    monthStatuses.mockImplementation(
      entries(
        new Map<string, BroadcastMonthStatus>([
          [at(0), { state: 'done', attempts: 1, since: NOW }],
          [at(1), { state: 'done', attempts: 2, since: NOW }],
          [at(2), { state: 'processing', attempts: 1, since: NOW }],
          // Failed within the day: unavailable, not retried tonight.
          [at(3), { state: 'failed', attempts: 3, since: NOW }],
          // Failed 5 minutes ago and still has attempts: waits (R-188).
          [
            at(4),
            {
              state: 'pending',
              attempts: 1,
              lastFailedAt: new Date(NOW.getTime() - 5 * MINUTE),
            },
          ],
          // Failed over a day ago: may be retried.
          [
            at(5),
            {
              state: 'failed',
              attempts: 3,
              since: new Date(NOW.getTime() - 25 * 60 * MINUTE),
            },
          ],
        ]),
      ),
    );
    expect(await preindex()(NOW)).toMatchObject({ queued: 7, ready: 2 });
    expect(need).toHaveBeenCalledWith(NEWEST.slice(5));
  });

  it('hands nothing when every month is ready', async () => {
    monthStatuses.mockImplementation(
      entries(
        new Map<string, BroadcastMonthStatus>(
          NEWEST.map((m) => [m, { state: 'done', attempts: 1, since: NOW }]),
        ),
      ),
    );
    expect(await preindex()(NOW)).toMatchObject({ queued: 0, ready: 12 });
    expect(need).toHaveBeenCalledWith([]);
  });

  it('says a community night still running', async () => {
    nightly.mockReturnValue('running');
    expect(await preindex()(NOW)).toMatchObject({ community: 'running' });
  });

  it('queues the months and logs once that the community part is off without a Lichess token', async () => {
    expect(await preindex(false)(NOW)).toEqual({
      queued: 12,
      ready: 0,
      community: 'off',
    });
    expect(need).toHaveBeenCalledWith(NEWEST);
    expect(warnings).toHaveBeenCalledExactlyOnceWith(
      'fide: LICHESS_TOKEN is not set; community broadcasts are off',
    );
  });

  it('starts no community night while no month is published', async () => {
    months.mockResolvedValue([]);
    expect(await preindex()(NOW)).toEqual({
      queued: 0,
      ready: 0,
      community: 'off',
    });
    expect(nightly).not.toHaveBeenCalled();
  });

  it('fails without handing anything when the month list cannot be read', async () => {
    months.mockRejectedValue(new Error('lichess down'));
    await expect(preindex()(NOW)).rejects.toThrow('lichess down');
    expect(need).not.toHaveBeenCalled();
    expect(nightly).not.toHaveBeenCalled();
  });
});
