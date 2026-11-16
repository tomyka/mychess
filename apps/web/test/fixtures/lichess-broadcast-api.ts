// A synthetic Lichess broadcast API (#349) for the component suite: the
// answers of `/api/broadcast/by/{account}`, `/api/broadcast/{tourId}` and
// the tour PGN, served by a fake fetch, so no test reaches the network.
// Names, ids and FIDE IDs are invented.
import type { Fetch } from '@mychess/integrations';

/** The token the fakes expect; any other request answers 401. */
export const FAKE_LICHESS_TOKEN = 'lip_fakeTestToken';

const API = 'https://lichess.org/api/broadcast';

export interface FakeTour {
  readonly id: string;
  readonly name: string;
  /** An official tournament has a tier. */
  readonly official?: boolean;
  /** Its first and last day, `YYYY-MM-DD`; none for a tour without dates. */
  readonly dates?: readonly [string, string];
  /** Its rounds' ids, each finished unless listed in `running`. */
  readonly rounds: readonly string[];
  readonly running?: readonly string[];
}

const instant = (day: string): number => Date.parse(`${day}T09:00:00Z`);

/** A tour as Lichess's JSON gives it. */
function tourJson(tour: FakeTour): Record<string, unknown> {
  return {
    id: tour.id,
    name: tour.name,
    slug: tour.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
    createdAt: instant(tour.dates?.[0] ?? '2026-01-01') - 86_400_000,
    ...(tour.dates === undefined ? {} : { dates: tour.dates.map(instant) }),
    ...(tour.official === true ? { tier: 4 } : {}),
  };
}

const finished = (tour: FakeTour, round: string): boolean =>
  !(tour.running ?? []).includes(round);

/** `GET /api/broadcast/{tourId}`: the tour with its rounds. */
export function tourDetailJson(tour: FakeTour): Record<string, unknown> {
  return {
    tour: tourJson(tour),
    rounds: tour.rounds.map((id, n) => ({
      id,
      name: `Round ${String(n + 1)}`,
      startsAt: instant(tour.dates?.[0] ?? '2026-01-01') + n * 86_400_000,
      ...(finished(tour, id) ? { finished: true } : {}),
    })),
  };
}

/** `GET /api/broadcast/by/{account}?page=n`: a page of the tours listed. */
export function toursPageJson(
  tours: readonly FakeTour[],
  nextPage: number | null,
): Record<string, unknown> {
  return {
    currentPageResults: tours.map((tour) => ({
      tour: tourJson(tour),
      ...(tour.rounds.every((round) => finished(tour, round))
        ? {}
        : { round: { id: tour.running?.[0] ?? tour.rounds[0] } }),
    })),
    nextPage,
  };
}

export interface FakeTourGame {
  readonly roundId: string;
  readonly gameId: string;
  readonly white: string;
  readonly black: string;
  readonly whiteFideId?: number;
  readonly blackFideId?: number;
  readonly date: string;
  readonly result: string;
}

/** A tour's PGN, as `GET /api/broadcast/{tourId}.pgn` streams it. */
export function tourPgn(
  tour: FakeTour,
  games: readonly FakeTourGame[],
): string {
  return games
    .map((game) => {
      const tags = [
        ['Event', `${tour.name} | Round 1`],
        ['Date', game.date.replaceAll('-', '.')],
        ['White', game.white],
        ['Black', game.black],
        ['Result', game.result],
        ...(game.whiteFideId === undefined
          ? []
          : [['WhiteFideId', String(game.whiteFideId)]]),
        ...(game.blackFideId === undefined
          ? []
          : [['BlackFideId', String(game.blackFideId)]]),
        ['BroadcastName', tour.name],
        [
          'GameURL',
          `https://lichess.org/broadcast/synthetic/round-1/${game.roundId}/${game.gameId}`,
        ],
      ];
      const headers = tags.map(
        ([name, value]) => `[${name ?? ''} "${value ?? ''}"]`,
      );
      return `${headers.join('\n')}\n\n1. e4 c6 ${game.result}\n\n`;
    })
    .join('');
}

/** What a fake URL answers: a JSON body, a text body, a status, or a hang. */
export type FakeAnswer =
  | { readonly json: unknown }
  | { readonly text: string }
  | { readonly status: number }
  | 'hang';

/**
 * A fetch answering the URLs in `answers` (each path after
 * `/api/broadcast/`) with their answers in turn, the last one again once
 * all were given; 404 for any other.
 */
export function fakeLichessApi(
  answers: Readonly<Record<string, readonly FakeAnswer[]>>,
): { readonly fetch: Fetch; readonly requested: string[] } {
  const requested: string[] = [];
  const served = new Map<string, number>();
  const fetch: Fetch = (url, init) => {
    requested.push(url);
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== `Bearer ${FAKE_LICHESS_TOKEN}`) {
      return Promise.resolve(new Response(null, { status: 401 }));
    }
    const path = url.startsWith(`${API}/`) ? url.slice(API.length + 1) : url;
    const listed = answers[path] ?? [];
    const n = served.get(path) ?? 0;
    served.set(path, n + 1);
    const answer = listed[Math.min(n, listed.length - 1)];
    return respond(answer, init.signal ?? undefined);
  };
  return { fetch, requested };
}

function respond(
  answer: FakeAnswer | undefined,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (answer === undefined)
    return Promise.resolve(new Response(null, { status: 404 }));
  if (answer === 'hang') {
    return new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  }
  if ('status' in answer)
    return Promise.resolve(new Response(null, { status: answer.status }));
  if ('text' in answer) return Promise.resolve(new Response(answer.text));
  return Promise.resolve(Response.json(answer.json));
}

/** The path of a tour's PGN, as the client asks for it. */
export const pgnPath = (tourId: string): string =>
  `${tourId}.pgn?clocks=false&comments=false`;
