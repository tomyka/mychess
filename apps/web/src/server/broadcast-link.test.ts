import { broadcastMonthSchema, type BroadcastMonth } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  tourDetailJson,
  tourJson,
  type FakeAnswer,
  type FakeTour,
} from '../../test/fixtures/lichess-broadcast-api';
import { addBroadcastLink, PASTE_WAIT_MS } from './broadcast-link';
import {
  createLichessPacer,
  LICHESS_PACE,
  NO_ABORT,
  sleep,
} from './lichess-pace';

const DB = { name: 'the db' };
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

const server = vi.hoisted(() => ({
  counted:
    vi.fn<
      (db: unknown, key: string, rule: unknown, now: Date) => Promise<unknown>
    >(),
  months: vi.fn<() => Promise<readonly string[]>>(),
  add: vi.fn<(tour: unknown) => Promise<boolean>>(),
  lichess: {
    fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  },
  community: true,
}));

vi.mock('@mychess/db', () => ({ countRateLimited: server.counted }));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('./fide-services', () => ({
  fideServices: () => ({
    sources: { months: server.months },
    community: server.community
      ? {
          pasteApi: {
            fetch: server.lichess.fetch,
            token: FAKE_LICHESS_TOKEN,
          },
          add: server.add,
        }
      : null,
  }),
}));

let requested: string[] = [];

function lichess(answers: Readonly<Record<string, readonly FakeAnswer[]>>) {
  const fake = fakeLichessApi(answers);
  requested = fake.requested;
  server.lichess.fetch.mockImplementation(fake.fetch);
}

const errors = vi.spyOn(console, 'error');

beforeEach(() => {
  server.community = true;
  server.counted.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.months.mockReset().mockResolvedValue(PUBLISHED);
  server.add.mockReset().mockResolvedValue(true);
  server.lichess.fetch.mockReset();
  errors.mockReset().mockImplementation(() => undefined);
  lichess({ VilOpn26: [{ json: tourDetailJson(TOUR) }] });
});

const paste = (raw: unknown) => addBroadcastLink('rokas', raw, NOW);

describe('adding a pasted Lichess broadcast (#349, R-197, spec decision 4)', () => {
  it('counts the link, fetches the tour, queues it as pasted and says it was added', async () => {
    expect(await paste(` ${TOUR_LINK} `)).toEqual({
      kind: 'added',
      name: 'Vilnius Open 2026',
    });
    expect(server.counted).toHaveBeenCalledExactlyOnceWith(
      DB,
      'broadcast-link:rokas',
      { windowMs: 86_400_000, max: 10, reason: 'fide.tooManyBroadcastLinks' },
      NOW,
    );
    expect(requested).toEqual(['https://lichess.org/api/broadcast/VilOpn26']);
    const [queued] = server.add.mock.lastCall ?? [];
    expect(queued).toEqual({
      id: 'VilOpn26',
      name: 'Vilnius Open 2026',
      official: false,
      lastRoundAt: new Date('2026-10-05T09:00:00Z'),
      origin: { kind: 'pasted' },
    });
  });

  it('resolves a round link to its tour first', async () => {
    lichess({
      '-/-/RoundAA2': [
        { json: { round: { id: 'RoundAA2' }, tour: tourJson(TOUR) } },
      ],
      VilOpn26: [{ json: tourDetailJson(TOUR) }],
    });
    expect(await paste(ROUND_LINK)).toMatchObject({ kind: 'added' });
    expect(requested).toEqual([
      'https://lichess.org/api/broadcast/-/-/RoundAA2',
      'https://lichess.org/api/broadcast/VilOpn26',
    ]);
    // One signal bounds the whole paste's wait, both calls (architect L).
    const [first, second] = server.lichess.fetch.mock.calls.map(
      ([, init]) => init.signal,
    );
    expect(first).toBeInstanceOf(AbortSignal);
    expect(first).not.toBe(NO_ABORT);
    expect(first?.aborted).toBe(false);
    expect(second).toBe(first);
  });

  it('gives a paste 30 seconds in all', () => {
    expect(PASTE_WAIT_MS).toBe(30_000);
  });

  it('answers unavailable once its signal aborts while it waits behind a 429 pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const fake = fakeLichessApi({
        blocked: [{ status: 429 }],
        VilOpn26: [{ json: tourDetailJson(TOUR) }],
      });
      requested = fake.requested;
      const pacer = createLichessPacer(fake.fetch, {
        ...LICHESS_PACE,
        sleep,
        clock: () => Date.now(),
      });
      const blocked = await pacer.fetch('night')(
        'https://lichess.org/api/broadcast/blocked',
        { headers: { Authorization: `Bearer ${FAKE_LICHESS_TOKEN}` } },
      );
      expect(blocked.status).toBe(429);
      server.lichess.fetch.mockImplementation(pacer.fetch('paste'));
      const controller = new AbortController();
      const answer = addBroadcastLink(
        'rokas',
        TOUR_LINK,
        NOW,
        controller.signal,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      controller.abort(new DOMException('timed out', 'TimeoutError'));
      expect(await answer).toEqual({
        kind: 'refused',
        refusal: 'fide.broadcastLinkUnavailable',
      });
      expect(requested).toEqual(['https://lichess.org/api/broadcast/blocked']);
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        'fide: broadcast link failed',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('says a tour already in the index was added already', async () => {
    server.add.mockResolvedValue(false);
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
    expect(server.counted).not.toHaveBeenCalled();
    expect(server.lichess.fetch).not.toHaveBeenCalled();
  });

  it('refuses a link without a Lichess token as not available, uncounted', async () => {
    server.community = false;
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
    expect(server.counted).not.toHaveBeenCalled();
  });

  it('refuses the 11th link of the day before asking Lichess', async () => {
    server.counted.mockResolvedValue({
      ok: false,
      refusal: { reason: 'fide.tooManyBroadcastLinks', limit: 10 },
    });
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.tooManyBroadcastLinks',
      limit: 10,
    });
    expect(server.lichess.fetch).not.toHaveBeenCalled();
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
    lichess({ VilOpn26: [{ json: tourDetailJson(tour) }] });
    expect(await paste(TOUR_LINK)).toEqual({ kind: 'refused', refusal });
    expect(server.add).not.toHaveBeenCalled();
  });

  it('refuses a tour Lichess does not know as not found', async () => {
    lichess({});
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.tourNotFound',
    });
  });

  it('refuses a round Lichess does not know as not found', async () => {
    lichess({});
    expect(await paste(ROUND_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.tourNotFound',
    });
    expect(requested).toHaveLength(1);
  });

  it.each([
    ['rate limited', { status: 429 }],
    ['down', { status: 503 }],
    ['refusing the token', { status: 401 }],
  ])('refuses as not available when Lichess is %s', async (_, answer) => {
    lichess({ VilOpn26: [answer] });
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
  });

  it('refuses as not available while no dump month is published', async () => {
    server.months.mockResolvedValue([]);
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
  });

  it('refuses as not available when something fails, logging no detail', async () => {
    server.add.mockRejectedValue(new Error(`insert failed: ${TOUR_LINK}`));
    expect(await paste(TOUR_LINK)).toEqual({
      kind: 'refused',
      refusal: 'fide.broadcastLinkUnavailable',
    });
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'fide: broadcast link failed',
    );
  });
});
