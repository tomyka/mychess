import type { BroadcastMonthEntry } from '@mychess/db';
import {
  broadcastMonthSchema,
  type BroadcastMonth,
  type BroadcastMonthStatus,
} from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const SECRET = 'cron-secret-cron-secret-cron-secret-00';
const ROUTE = 'http://localhost/api/cron/index-broadcasts';
const DB = { name: 'the db' };
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

const server = vi.hoisted(() => ({
  statuses:
    vi.fn<(db: unknown, months: readonly string[]) => Promise<unknown>>(),
  need: vi.fn<(months: readonly string[]) => void>(),
  settled: vi.fn<() => Promise<void>>(),
  months: vi.fn<() => Promise<readonly string[]>>(),
}));

vi.mock('@mychess/db', () => ({ broadcastMonthStatuses: server.statuses }));
vi.mock('../../../../server/db', () => ({ getDb: () => DB }));
vi.mock('../../../../server/fide-services', () => ({
  fideServices: () => ({
    runner: { need: server.need, settled: server.settled },
    sources: { months: server.months, player: vi.fn() },
    secret: 'a-test-secret-of-at-least-32-characters!',
  }),
}));

/** The months' entries with `statuses` by month, pending otherwise. */
function entries(
  statuses: ReadonlyMap<string, BroadcastMonthStatus>,
): (db: unknown, months: readonly string[]) => Promise<BroadcastMonthEntry[]> {
  return (_db, months) =>
    Promise.resolve(
      months.map((m) => ({
        month: month(m),
        status: statuses.get(m) ?? {
          state: 'pending',
          attempts: 0,
          lastFailedAt: null,
        },
      })),
    );
}

const call = (authorization?: string): Promise<Response> =>
  GET(
    new Request(
      ROUTE,
      authorization === undefined ? {} : { headers: { authorization } },
    ),
  );

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.statuses.mockReset().mockImplementation(entries(new Map()));
  server.need.mockReset();
  // The runner's work never ends here: the route must not wait for it.
  server.settled.mockReset().mockReturnValue(new Promise(() => undefined));
  server.months.mockReset().mockResolvedValue(LISTED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/index-broadcasts (#354, R-195)', () => {
  it('queues every one of the 12 newest months still to index and answers 202 with counts', async () => {
    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ queued: 12, ready: 0 });
    expect(server.statuses).toHaveBeenCalledWith(DB, NEWEST);
    expect(server.need).toHaveBeenCalledTimes(1);
    expect(server.need).toHaveBeenCalledWith(NEWEST);
    expect(server.settled).not.toHaveBeenCalled();
  });

  it('queues only the months whose next action is process', async () => {
    server.statuses.mockImplementation(
      entries(
        new Map<string, BroadcastMonthStatus>([
          [at(0), { state: 'done', attempts: 1, since: NOW }],
          [at(1), { state: 'done', attempts: 2, since: NOW }],
          [at(2), { state: 'processing', attempts: 1, since: NOW }],
          // Failed within the day: unavailable, not retried tonight.
          [at(3), { state: 'failed', attempts: 3, since: NOW }],
          // Failed 10 minutes ago and still has attempts: waits (R-188).
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

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: 7, ready: 2 });
    expect(server.need).toHaveBeenCalledWith(NEWEST.slice(5));
  });

  it('answers 202 with nothing queued when every month is ready', async () => {
    server.statuses.mockImplementation(
      entries(
        new Map<string, BroadcastMonthStatus>(
          NEWEST.map((m) => [m, { state: 'done', attempts: 1, since: NOW }]),
        ),
      ),
    );

    const response = await call(`Bearer ${SECRET}`);

    expect(await response.json()).toEqual({ queued: 0, ready: 12 });
    expect(server.need).toHaveBeenCalledWith([]);
  });

  it.each([
    ['no authorization', undefined],
    ['a wrong secret', 'Bearer not-the-secret'],
    ['the secret without Bearer', SECRET],
  ])('refuses %s with 401 and reads nothing', async (_, authorization) => {
    const response = await call(authorization);

    expect(response.status).toBe(401);
    expect(server.months).not.toHaveBeenCalled();
    expect(server.need).not.toHaveBeenCalled();
  });

  it('does not exist where CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', undefined);

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(404);
    expect(server.months).not.toHaveBeenCalled();
  });

  it('fails without queuing when the month list cannot be read', async () => {
    server.months.mockRejectedValue(new Error('lichess down'));

    await expect(call(`Bearer ${SECRET}`)).rejects.toThrow('lichess down');
    expect(server.need).not.toHaveBeenCalled();
  });
});
