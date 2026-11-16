import {
  broadcastMonthSchema,
  type BroadcastWindow,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  toursPageJson,
  type FakeAnswer,
  type FakeTour,
} from '../../test/fixtures/lichess-broadcast-api';
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

const page = (n: number) => `by/vakarinis?page=${String(n)}`;
const by = (account: string) => `by/${account}?page=1`;
const EMPTY: FakeAnswer = { json: toursPageJson([], null) };

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

async function list(answers: Readonly<Record<string, readonly FakeAnswer[]>>) {
  const lichess = fakeLichessApi({
    [by('kesnor7')]: [EMPTY],
    [by('paulauskas')]: [EMPTY],
    ...answers,
  });
  const listing = await listOrganiserTours(
    {
      api: { fetch: lichess.fetch, token: FAKE_LICHESS_TOKEN },
      queue,
    },
    WINDOW,
    NOW,
  );
  return { listing, requested: lichess.requested };
}

const path = (url: string) =>
  url.replace('https://lichess.org/api/broadcast/', '');

describe('the nightly organiser listing (#349, spec decisions 2 and 3)', () => {
  it('lists every approved organiser and queues the finished tours that qualify', async () => {
    const { listing, requested } = await list({
      [page(1)]: [
        {
          json: toursPageJson(
            [RUNNING, OFFICIAL_NEW, COMMUNITY, OFFICIAL_IN_DUMPS],
            null,
          ),
        },
      ],
    });
    expect(requested.map(path)).toEqual([
      by('vakarinis'),
      by('kesnor7'),
      by('paulauskas'),
    ]);
    expect(queued).toEqual([
      expect.objectContaining({
        id: OFFICIAL_NEW.id,
        name: 'Tour Offici01',
        official: true,
        lastRoundAt: new Date('2026-10-20T09:00:00Z'),
        origin: { kind: 'organiser', organiser: 'vakarinis' },
      }),
      expect.objectContaining({ id: COMMUNITY.id, official: false }),
    ]);
    expect(listing).toEqual({ queued: 2, stopped: false });
  });

  it('counts only the tours that were new to the index', async () => {
    queue.mockImplementationOnce(() => Promise.resolve(false));
    const { listing } = await list({
      [page(1)]: [{ json: toursPageJson([OFFICIAL_NEW, COMMUNITY], null) }],
    });
    expect(queue).toHaveBeenCalledTimes(2);
    expect(listing.queued).toBe(1);
  });

  it('reads further pages until a page holds only tours older than the window', async () => {
    const { requested } = await list({
      [page(1)]: [{ json: toursPageJson([COMMUNITY], 2) }],
      [page(2)]: [{ json: toursPageJson([OLD, COMMUNITY], 3) }],
      [page(3)]: [{ json: toursPageJson([OLD], 4) }],
      [page(4)]: [{ json: toursPageJson([COMMUNITY], null) }],
    });
    expect(requested.map(path).slice(0, 3)).toEqual([
      page(1),
      page(2),
      page(3),
    ]);
    expect(requested.map(path)).not.toContain(page(4));
  });

  it('stops paging on the last page', async () => {
    const { requested } = await list({
      [page(1)]: [{ json: toursPageJson([COMMUNITY], null) }],
    });
    expect(requested.map(path).filter((p) => p.includes('vakarinis'))).toEqual([
      page(1),
    ]);
  });

  // The pacer holds the next request a minute after a 429 (lichess-pace).
  it('asks again after a 429', async () => {
    const { listing, requested } = await list({
      [page(1)]: [{ status: 429 }, { json: toursPageJson([COMMUNITY], null) }],
    });
    expect(requested.map(path)).toEqual([
      page(1),
      page(1),
      by('kesnor7'),
      by('paulauskas'),
    ]);
    expect(listing).toEqual({ queued: 1, stopped: false });
  });

  it('stops for the night on a second 429', async () => {
    const { listing, requested } = await list({
      [page(1)]: [{ status: 429 }, { json: toursPageJson([COMMUNITY], null) }],
      [by('kesnor7')]: [{ status: 429 }],
    });
    expect(requested.map(path)).toEqual([page(1), page(1), by('kesnor7')]);
    expect(listing).toEqual({ queued: 1, stopped: true });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser listing stopped for the night on a second 429',
    );
  });

  it('logs an organiser Lichess refuses by the refusal and goes on to the next', async () => {
    const { listing, requested } = await list({
      [page(1)]: [{ status: 404 }],
      [by('kesnor7')]: [{ json: toursPageJson([COMMUNITY], null) }],
    });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser vakarinis not listed',
      'lichessBroadcast.notFound',
    );
    expect(requested).toHaveLength(3);
    expect(listing.queued).toBe(1);
  });

  it('logs an organiser whose listing fails, never its error text, and goes on', async () => {
    queue.mockRejectedValueOnce(new TypeError('insert failed: Tour Commun01'));
    const { listing } = await list({
      [page(1)]: [{ json: toursPageJson([COMMUNITY], null) }],
      [by('kesnor7')]: [{ json: toursPageJson([COMMUNITY], null) }],
    });
    expect(warnings).toHaveBeenCalledWith(
      'fide: organiser vakarinis not listed',
      'TypeError',
    );
    expect(listing.queued).toBe(1);
  });
});
