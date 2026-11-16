import { broadcastTourIdSchema, parseBroadcastLink } from '@mychess/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  pgnPath,
  tourDetailJson,
  tourJson,
  toursPageJson,
  tourPgn,
  type FakeAnswer,
  type FakeTour,
} from '../../test/fixtures/lichess-broadcast-api';
import { withDownloadLimits } from './broadcast-limits';
import { createLichessBroadcasts, PASTE_WAIT_MS } from './lichess-broadcasts';

const T0 = Date.UTC(2026, 10, 16, 3);
const TOUR_ID = broadcastTourIdSchema.parse('VilOpn26');

const TOUR: FakeTour = {
  id: TOUR_ID,
  name: 'Vilnius Open 2026',
  dates: ['2026-10-01', '2026-10-05'],
  rounds: ['RoundAA1', 'RoundAA2'],
};

const PGN = tourPgn(TOUR, [
  {
    roundId: 'RoundAA1',
    gameId: 'GameAAA1',
    white: 'Pavyzdyte, Ruta',
    black: 'Testas, Jonas',
    whiteFideId: 90_000_001,
    blackFideId: 90_000_002,
    date: '2026-10-01',
    result: '1-0',
  },
]);

/** A path of the Lichess broadcast API, as the fake records it. */
const path = (url: string): string =>
  url.replace('https://lichess.org/api/broadcast/', '');

/** A timeout on the fake clock, as AbortSignal.timeout is on the real one. */
function fakeTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException('timed out', 'TimeoutError'));
  }, ms);
  return controller.signal;
}

/** What the pause-making call is recorded as. */
const BLOCKED = 'by/vakarinis?page=1';

/**
 * The gateway over a fake Lichess, on the fake clock. `pause` asks for a
 * page Lichess answers 429, so every later call waits a minute.
 */
function gateway(answers: Readonly<Record<string, readonly FakeAnswer[]>>) {
  const lichess = fakeLichessApi({ [BLOCKED]: [{ status: 429 }], ...answers });
  const sent: [string, number][] = [];
  const broadcasts = createLichessBroadcasts({
    fetch: (url, init) => {
      sent.push([path(url), Date.now() - T0]);
      return lichess.fetch(url, init);
    },
    token: FAKE_LICHESS_TOKEN,
    clock: () => Date.now(),
    timeout: fakeTimeout,
  });
  const pause = async (): Promise<void> => {
    expect(await broadcasts.organiserPage('vakarinis', 1)).toEqual({
      ok: false,
      refusal: { reason: 'lichessBroadcast.rateLimited' },
    });
  };
  return { broadcasts, sent, pause };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Lichess broadcast gateway (#349)', () => {
  it('lists a page of an organiser’s tournaments', async () => {
    const { broadcasts, sent } = gateway({
      'by/kesnor7?page=2': [{ json: toursPageJson([TOUR], 3) }],
    });
    const page = await broadcasts.organiserPage('kesnor7', 2);
    expect(page.ok && page.value.nextPage).toBe(3);
    expect(page.ok && page.value.tours[0]?.tour.id).toBe(TOUR_ID);
    expect(sent).toEqual([['by/kesnor7?page=2', 0]]);
  });

  it('describes a tournament with its rounds', async () => {
    const { broadcasts } = gateway({
      [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
    });
    const detail = await broadcasts.tour(TOUR_ID);
    expect(detail.ok && detail.value.rounds.map((round) => round.id)).toEqual([
      'RoundAA1',
      'RoundAA2',
    ]);
  });

  it('answers a Lichess refusal as a value', async () => {
    const { broadcasts } = gateway({ [TOUR_ID]: [{ status: 404 }] });
    expect(await broadcasts.tour(TOUR_ID)).toEqual({
      ok: false,
      refusal: { reason: 'lichessBroadcast.notFound' },
    });
  });

  it('gives a night call 15 seconds from its turn, then answers unavailable', async () => {
    const { broadcasts, pause } = gateway({ [TOUR_ID]: ['hang'] });
    await pause();
    const detail = broadcasts.tour(TOUR_ID);
    // Its 60 s wait behind the pause does not count.
    await vi.advanceTimersByTimeAsync(60_000 + 14_999);
    let settled = false;
    void detail.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await detail).toEqual({
      ok: false,
      refusal: { reason: 'lichessBroadcast.unavailable' },
    });
  });

  it('holds every call for a minute after a 429', async () => {
    const { broadcasts, sent, pause } = gateway({
      [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
    });
    await pause();
    const detail = broadcasts.tour(TOUR_ID);
    await vi.runAllTimersAsync();
    expect((await detail).ok).toBe(true);
    expect(sent).toEqual([
      [BLOCKED, 0],
      [TOUR_ID, 60_000],
    ]);
  });

  describe('a pasted link', () => {
    const roundLink = parseBroadcastLink(
      'https://lichess.org/broadcast/vilnius-open-2026/round-2/RoundAA2',
    );
    const tourLink = parseBroadcastLink(
      'https://lichess.org/broadcast/vilnius-open-2026/VilOpn26',
    );
    if (!roundLink.ok || !tourLink.ok) throw new Error('fixture links');

    it('resolves a round to its tournament and describes it', async () => {
      const { broadcasts, sent } = gateway({
        '-/-/RoundAA2': [
          { json: { round: { id: 'RoundAA2' }, tour: tourJson(TOUR) } },
        ],
        [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
      });
      const detail = broadcasts.pastedTour(roundLink.value);
      await vi.runAllTimersAsync();
      expect((await detail).ok && (await detail).ok).toBe(true);
      expect(sent).toEqual([
        ['-/-/RoundAA2', 0],
        [TOUR_ID, 1000],
      ]);
    });

    it('describes a tournament link at once', async () => {
      const { broadcasts, sent } = gateway({
        [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
      });
      expect((await broadcasts.pastedTour(tourLink.value)).ok).toBe(true);
      expect(sent).toEqual([[TOUR_ID, 0]]);
    });

    it('answers not found for a round Lichess does not know, asking nothing more', async () => {
      const { broadcasts, sent } = gateway({});
      expect(await broadcasts.pastedTour(roundLink.value)).toEqual({
        ok: false,
        refusal: { reason: 'lichessBroadcast.notFound' },
      });
      expect(sent).toHaveLength(1);
    });

    it('goes after every night and download call waiting (security M1d)', async () => {
      const { broadcasts, sent } = gateway({
        'by/kesnor7?page=1': [{ json: toursPageJson([], null) }],
        [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
        [pgnPath(TOUR_ID)]: [{ text: PGN }],
      });
      // The first call is sent at once; the rest queue behind it.
      const first = broadcasts.organiserPage('kesnor7', 1);
      const pasted = broadcasts.pastedTour(tourLink.value);
      const night = broadcasts.tour(TOUR_ID);
      const download = withDownloadLimits(
        { deadlineMs: 600_000, idleMs: 600_000 },
        async (signal, idle) => {
          const opened = await broadcasts.openPgn(TOUR_ID, { signal, idle });
          if (opened.ok) await opened.value[Symbol.asyncDispose]();
        },
      );
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.all([first, pasted, night, download]);
      expect(sent).toEqual([
        ['by/kesnor7?page=1', 0],
        [TOUR_ID, 1000],
        [pgnPath(TOUR_ID), 2000],
        [TOUR_ID, 3000],
      ]);
    });

    it('waits at most 30 seconds in all, then answers unavailable unsent (architect L)', async () => {
      expect(PASTE_WAIT_MS).toBe(30_000);
      const { broadcasts, sent, pause } = gateway({
        [TOUR_ID]: [{ json: tourDetailJson(TOUR) }],
      });
      await pause();
      const pasted = broadcasts.pastedTour(tourLink.value);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pasted).toEqual({
        ok: false,
        refusal: { reason: 'lichessBroadcast.unavailable' },
      });
      expect(sent).toEqual([[BLOCKED, 0]]);
    });
  });

  describe('a tournament’s PGN', () => {
    it('arms the idle limit when the request is sent: a download queued behind a 60 s pause still completes', async () => {
      const { broadcasts, sent, pause } = gateway({
        [pgnPath(TOUR_ID)]: [{ text: PGN }],
      });
      await pause();
      const games: unknown[] = [];
      const done = withDownloadLimits(
        // An idle limit far shorter than the pause.
        { deadlineMs: 600_000, idleMs: 5000 },
        async (signal, idle) => {
          const opened = await broadcasts.openPgn(TOUR_ID, { signal, idle });
          if (!opened.ok) throw new Error(opened.refusal.reason);
          await using pgn = opened.value;
          idle.disarm();
          for await (const game of idle.watch(pgn.games)) games.push(game);
        },
      );
      await vi.advanceTimersByTimeAsync(61_000);
      await done;
      expect(games).toEqual([
        expect.objectContaining({ whiteFideId: 90_000_001 }),
      ]);
      expect(sent).toEqual([
        [BLOCKED, 0],
        [pgnPath(TOUR_ID), 60_000],
      ]);
    });

    it('is not timed by the gateway: the runner’s limits bound it', async () => {
      const { broadcasts } = gateway({ [pgnPath(TOUR_ID)]: [{ text: PGN }] });
      const controller = new AbortController();
      const done = withDownloadLimits(
        { deadlineMs: 600_000, idleMs: 600_000 },
        async (_signal, idle) => {
          const opened = await broadcasts.openPgn(TOUR_ID, {
            signal: controller.signal,
            idle,
          });
          if (!opened.ok) throw new Error(opened.refusal.reason);
          idle.disarm();
          // Long past a night call's 15 s, the PGN is still open.
          await vi.advanceTimersByTimeAsync(120_000);
          await using pgn = opened.value;
          const games: unknown[] = [];
          for await (const game of pgn.games) games.push(game);
          return games;
        },
      );
      expect(await done).toHaveLength(1);
    });
  });
});
