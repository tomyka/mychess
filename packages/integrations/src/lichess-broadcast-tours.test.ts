import { describe, expect, it } from 'vitest';
import {
  LICHESS_BROADCAST_REFUSALS,
  type LichessApi,
} from './lichess-broadcast-request';
import {
  LICHESS_BROADCAST_MAX_PAGE,
  lichessBroadcastTour,
  lichessBroadcastsBy,
} from './lichess-broadcast-tours';
import {
  fakeFetch,
  never,
  stalledResponse,
  streamedResponse,
  trackedResponse,
  type FakeFetch,
} from './test-support';

const TOKEN = 'lip_SyntheticToken123';
const BY_URL = 'https://lichess.org/api/broadcast/by/organiser_1?page=1';
const TOUR_URL = 'https://lichess.org/api/broadcast/AbCd1234';

const START = Date.UTC(2026, 6, 10, 15);
const END = Date.UTC(2026, 6, 16, 15);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function api(fetch: FakeFetch, token = TOKEN): LichessApi {
  return { fetch, token };
}

/** A synthetic tournament in the documented shape (BroadcastTour). */
const COMMUNITY_TOUR = {
  id: 'AbCd1234',
  name: 'Synthetic Open 2026',
  slug: 'synthetic-open-2026',
  info: { format: '9-round Swiss' },
  createdAt: START - 86_400_000,
  dates: [START, END],
  url: 'https://lichess.org/broadcast/synthetic-open-2026/AbCd1234',
  communityOwner: { name: 'Organiser_1' },
};

const OFFICIAL_TOUR = {
  ...COMMUNITY_TOUR,
  id: 'OfFi1234',
  name: 'Synthetic Championship',
  slug: 'synthetic-championship',
  tier: 3,
  dates: [START],
  communityOwner: undefined,
};

const PARSED_COMMUNITY = {
  id: 'AbCd1234',
  name: 'Synthetic Open 2026',
  slug: 'synthetic-open-2026',
  official: false,
  createdAt: new Date(START - 86_400_000),
  dates: { start: new Date(START), end: new Date(END) },
};

function round(id: string, extra: Record<string, unknown>): object {
  return {
    id,
    name: `Round ${id}`,
    slug: `round-${id.toLowerCase()}`,
    url: `https://lichess.org/broadcast/synthetic-open-2026/round/${id}`,
    ...extra,
  };
}

function page(results: unknown[], nextPage: number | null = null): object {
  return {
    currentPage: 1,
    maxPerPage: 24,
    currentPageResults: results,
    nbResults: results.length,
    previousPage: null,
    nextPage,
    nbPages: nextPage ?? 1,
  };
}

describe('lichessBroadcastsBy', () => {
  it('lists the tours of a page, official when tiered, finished when no round is unfinished', async () => {
    const fetch = fakeFetch({
      [BY_URL]: json(
        page([
          { tour: COMMUNITY_TOUR },
          {
            tour: OFFICIAL_TOUR,
            round: round('Live0001', { ongoing: true }),
          },
        ]),
      ),
    });
    await expect(
      lichessBroadcastsBy(api(fetch), 'organiser_1', 1, never),
    ).resolves.toEqual({
      ok: true,
      value: {
        tours: [
          { tour: PARSED_COMMUNITY, finished: true },
          {
            tour: {
              id: 'OfFi1234',
              name: 'Synthetic Championship',
              slug: 'synthetic-championship',
              official: true,
              createdAt: new Date(START - 86_400_000),
              dates: { start: new Date(START), end: new Date(START) },
            },
            finished: false,
          },
        ],
        nextPage: null,
      },
    });
  });

  it('sends the token, the User-Agent, and refuses redirects', async () => {
    const fetch = fakeFetch({ [BY_URL]: json(page([])) });
    await lichessBroadcastsBy(api(fetch), 'organiser_1', 1, never);
    expect(fetch.calls).toHaveLength(1);
    const init = fetch.calls[0]?.init;
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBe(never);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'MyChess (+https://mychess.lt)',
    });
  });

  it('asks for the page given and hands on the next one', async () => {
    const url = 'https://lichess.org/api/broadcast/by/organiser_1?page=2';
    const fetch = fakeFetch({ [url]: json(page([], 3)) });
    await expect(
      lichessBroadcastsBy(api(fetch), 'organiser_1', 2, never),
    ).resolves.toEqual({ ok: true, value: { tours: [], nextPage: 3 } });
  });

  it(`gives no next page past page ${String(LICHESS_BROADCAST_MAX_PAGE)}`, async () => {
    const url = `https://lichess.org/api/broadcast/by/organiser_1?page=${String(LICHESS_BROADCAST_MAX_PAGE)}`;
    const fetch = fakeFetch({
      [url]: json(page([], LICHESS_BROADCAST_MAX_PAGE + 1)),
    });
    const listed = await lichessBroadcastsBy(
      api(fetch),
      'organiser_1',
      LICHESS_BROADCAST_MAX_PAGE,
      never,
    );
    expect(listed).toEqual({ ok: true, value: { tours: [], nextPage: null } });
  });

  it('reads a tour without dates', async () => {
    const fetch = fakeFetch({
      [BY_URL]: json(page([{ tour: { ...COMMUNITY_TOUR, dates: undefined } }])),
    });
    const listed = await lichessBroadcastsBy(
      api(fetch),
      'organiser_1',
      1,
      never,
    );
    expect(listed.ok && listed.value.tours[0]?.tour.dates).toBeNull();
  });

  it('strips control and format characters from a name', async () => {
    const name = '‮Synthetic\u0007 Open​ 2026⁦ ';
    const fetch = fakeFetch({
      [BY_URL]: json(page([{ tour: { ...COMMUNITY_TOUR, name } }])),
    });
    const listed = await lichessBroadcastsBy(
      api(fetch),
      'organiser_1',
      1,
      never,
    );
    expect(listed.ok && listed.value.tours[0]?.tour.name).toBe(
      'Synthetic Open 2026',
    );
  });

  it.each([
    ['a slug of another shape', 'Synthetic Open/2026'],
    ['an empty slug', ''],
    ['a slug over 200 characters', 'a'.repeat(201)],
    ['no slug', undefined],
  ])('keeps a tour with %s, without its slug', async (_, slug) => {
    const fetch = fakeFetch({
      [BY_URL]: json(page([{ tour: { ...COMMUNITY_TOUR, slug } }])),
    });
    const listed = await lichessBroadcastsBy(
      api(fetch),
      'organiser_1',
      1,
      never,
    );
    expect(listed).toMatchObject({
      ok: true,
      value: { tours: [{ tour: { id: 'AbCd1234', slug: null } }] },
    });
  });

  it.each([
    ['no community owner', undefined],
    ['a community owner of another shape', { id: 42 }],
  ])('keeps a tour with %s', async (_, communityOwner) => {
    const fetch = fakeFetch({
      [BY_URL]: json(page([{ tour: { ...COMMUNITY_TOUR, communityOwner } }])),
    });
    const listed = await lichessBroadcastsBy(
      api(fetch),
      'organiser_1',
      1,
      never,
    );
    expect(listed).toEqual({
      ok: true,
      value: {
        tours: [{ tour: PARSED_COMMUNITY, finished: true }],
        nextPage: null,
      },
    });
  });

  it.each(['', 'a', 'a'.repeat(31), '../x', 'org/1', 'org?x=1', 'org 1'])(
    'throws for the account %j before any request',
    async (account) => {
      const fetch = fakeFetch({});
      await expect(
        lichessBroadcastsBy(api(fetch), account, 1, never),
      ).rejects.toThrow(RangeError);
      expect(fetch.calls).toEqual([]);
    },
  );

  it.each([0, -1, 1.5, LICHESS_BROADCAST_MAX_PAGE + 1, Number.NaN])(
    'throws for page %s before any request',
    async (pageNumber) => {
      const fetch = fakeFetch({});
      await expect(
        lichessBroadcastsBy(api(fetch), 'organiser_1', pageNumber, never),
      ).rejects.toThrow(RangeError);
      expect(fetch.calls).toEqual([]);
    },
  );

  it.each([
    [
      'a tour without an id',
      page([{ tour: { ...COMMUNITY_TOUR, id: undefined } }]),
    ],
    [
      'a tour id that is no Lichess ID',
      page([{ tour: { ...COMMUNITY_TOUR, id: 'AbCd/../1' } }]),
    ],
    ['a blank name', page([{ tour: { ...COMMUNITY_TOUR, name: ' ' } }])],
    [
      'a name of only control and format characters',
      page([{ tour: { ...COMMUNITY_TOUR, name: '\u0007‮​' } }]),
    ],
    [
      'a name over 200 characters',
      page([{ tour: { ...COMMUNITY_TOUR, name: 'a'.repeat(201) } }]),
    ],
    [
      'three dates',
      page([{ tour: { ...COMMUNITY_TOUR, dates: [START, END, END] } }]),
    ],
    [
      'a date that is not a number',
      page([{ tour: { ...COMMUNITY_TOUR, dates: ['2026-07-10'] } }]),
    ],
    ['a negative date', page([{ tour: { ...COMMUNITY_TOUR, createdAt: -1 } }])],
    ['no results', { ...page([]), currentPageResults: undefined }],
    ['a next page that is not a page', page([], 0)],
  ])('refuses an answer with %s', async (_, body) => {
    const fetch = fakeFetch({ [BY_URL]: json(body) });
    await expect(
      lichessBroadcastsBy(api(fetch), 'organiser_1', 1, never),
    ).resolves.toEqual({
      ok: false,
      refusal: { reason: LICHESS_BROADCAST_REFUSALS.invalid },
    });
  });
});

describe('lichessBroadcastTour', () => {
  it('reads a tour with its rounds, finished when every round is', async () => {
    const fetch = fakeFetch({
      [TOUR_URL]: json({
        tour: COMMUNITY_TOUR,
        rounds: [
          round('RoUnD001', { startsAt: START, finishedAt: START + 3_600_000 }),
          round('RoUnD002', { startsAt: END, finished: true }),
        ],
        defaultRoundId: 'RoUnD001',
        photos: {},
      }),
    });
    await expect(
      lichessBroadcastTour(api(fetch), 'AbCd1234', never),
    ).resolves.toEqual({
      ok: true,
      value: {
        tour: PARSED_COMMUNITY,
        rounds: [
          {
            id: 'RoUnD001',
            startsAt: new Date(START),
            finishedAt: new Date(START + 3_600_000),
            finished: true,
          },
          {
            id: 'RoUnD002',
            startsAt: new Date(END),
            finishedAt: null,
            finished: true,
          },
        ],
        finished: true,
      },
    });
    expect(fetch.calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it.each([
    [
      'a round still to play',
      [
        round('RoUnD001', { finished: true }),
        round('RoUnD002', { startsAt: END }),
      ],
    ],
    [
      'a round being played',
      [round('RoUnD001', { ongoing: true, finished: false })],
    ],
    ['no rounds', []],
  ])('takes a tour with %s as unfinished', async (_, rounds) => {
    const fetch = fakeFetch({
      [TOUR_URL]: json({ tour: COMMUNITY_TOUR, rounds }),
    });
    const tour = await lichessBroadcastTour(api(fetch), 'AbCd1234', never);
    expect(tour.ok && tour.value.finished).toBe(false);
  });

  it('refuses a tour other than the one asked for', async () => {
    const fetch = fakeFetch({
      [TOUR_URL]: json({ tour: OFFICIAL_TOUR, rounds: [] }),
    });
    await expect(
      lichessBroadcastTour(api(fetch), 'AbCd1234', never),
    ).resolves.toEqual({
      ok: false,
      refusal: { reason: LICHESS_BROADCAST_REFUSALS.invalid },
    });
  });

  it('refuses a round id that is no Lichess ID', async () => {
    const fetch = fakeFetch({
      [TOUR_URL]: json({ tour: COMMUNITY_TOUR, rounds: [round('x/y', {})] }),
    });
    const tour = await lichessBroadcastTour(api(fetch), 'AbCd1234', never);
    expect(tour.ok).toBe(false);
  });

  it.each(['AbCd123', 'AbCd12345', 'AbCd/234', '../../xy', 'AbCd123?', ''])(
    'throws for the tour id %j before any request',
    async (id) => {
      const fetch = fakeFetch({});
      await expect(lichessBroadcastTour(api(fetch), id, never)).rejects.toThrow(
        RangeError,
      );
      expect(fetch.calls).toEqual([]);
    },
  );
});

describe('every Lichess broadcast request', () => {
  const tourOf = (fetch: FakeFetch, token = TOKEN) =>
    lichessBroadcastTour(api(fetch, token), 'AbCd1234', never);

  it.each([
    [404, LICHESS_BROADCAST_REFUSALS.notFound],
    [429, LICHESS_BROADCAST_REFUSALS.rateLimited],
    [401, LICHESS_BROADCAST_REFUSALS.unauthorized],
    [403, LICHESS_BROADCAST_REFUSALS.unauthorized],
    [500, LICHESS_BROADCAST_REFUSALS.unavailable],
    [503, LICHESS_BROADCAST_REFUSALS.unavailable],
  ])('refuses status %s, and cancels its body', async (status, reason) => {
    const answer = trackedResponse([new Uint8Array(2)], status);
    const fetch = fakeFetch({ [TOUR_URL]: answer.response });
    await expect(tourOf(fetch)).resolves.toEqual({
      ok: false,
      refusal: { reason },
    });
    expect(answer.cancelled()).toBe(true);
  });

  it('refuses a failed request as unavailable', async () => {
    const fetch = Object.assign(
      () => Promise.reject(new TypeError('fetch failed')),
      { calls: [] },
    );
    await expect(tourOf(fetch)).resolves.toEqual({
      ok: false,
      refusal: { reason: LICHESS_BROADCAST_REFUSALS.unavailable },
    });
  });

  it('refuses a body that fails while read as unavailable', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const fetch = fakeFetch({ [TOUR_URL]: new Response(body) });
    await expect(tourOf(fetch)).resolves.toEqual({
      ok: false,
      refusal: { reason: LICHESS_BROADCAST_REFUSALS.unavailable },
    });
  });

  it.each([
    ['text that is not JSON', new Response('<html>')],
    [
      'an answer over 2 MB, counted while reading',
      streamedResponse(
        Array.from({ length: 2049 }, () => new Uint8Array(1024).fill(32)),
      ),
    ],
  ])('refuses %s as invalid', async (_, response) => {
    const fetch = fakeFetch({ [TOUR_URL]: response });
    await expect(tourOf(fetch)).resolves.toEqual({
      ok: false,
      refusal: { reason: LICHESS_BROADCAST_REFUSALS.invalid },
    });
  });

  it('fails with the abort reason when aborted, not with a refusal', async () => {
    const controller = new AbortController();
    const stalled = stalledResponse();
    const fetch = fakeFetch({ [TOUR_URL]: stalled.response });
    const reading = lichessBroadcastTour(
      api(fetch),
      'AbCd1234',
      controller.signal,
    );
    const reason = new Error('shutting down');
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
    expect(stalled.cancelled()).toBe(true);
  });

  it('fails with the abort reason when the request fails after an abort', async () => {
    const controller = new AbortController();
    const reason = new Error('shutting down');
    controller.abort(reason);
    const fetch = Object.assign(
      () => Promise.reject(new DOMException('aborted', 'AbortError')),
      { calls: [] },
    );
    await expect(
      lichessBroadcastTour(api(fetch), 'AbCd1234', controller.signal),
    ).rejects.toBe(reason);
  });

  it.each(['lip_with space', 'lip_x\r\nX-Evil: 1', 'lip_é', 'a'.repeat(257)])(
    'throws for a malformed token, without the token, before any request',
    async (token) => {
      const fetch = fakeFetch({});
      const error: unknown = await tourOf(fetch, token).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(RangeError);
      expect(String(error)).not.toContain(token);
      expect(fetch.calls).toEqual([]);
    },
  );

  it('throws for a missing token before any request', async () => {
    const fetch = fakeFetch({});
    await expect(tourOf(fetch, '')).rejects.toThrow(RangeError);
    expect(fetch.calls).toEqual([]);
  });

  it('never puts the token in a refusal', async () => {
    const fetch = fakeFetch({ [TOUR_URL]: json({ error: TOKEN }, 404) });
    const tour = await tourOf(fetch);
    expect(JSON.stringify(tour)).not.toContain(TOKEN);
  });
});
