// An in-memory adapter at the Lichess broadcast gateway's seam (#349):
// the runner, night and paste tests ask it as they ask the real gateway
// (src/server/lichess-broadcasts.ts), with no fetch, pacer or clock behind
// it. Its world is a few tournaments, each organiser's pages, and answers
// scripted per call. Every call is recorded by name.
import {
  LICHESS_BROADCAST_REFUSALS,
  broadcastGames,
  type LichessBroadcastPage,
  type LichessBroadcastPgn,
  type LichessBroadcastRefusal,
  type LichessBroadcastResult,
  type LichessBroadcastTour,
  type LichessBroadcastTourDetail,
} from '@mychess/integrations';
import {
  ok,
  refuse,
  type ApprovedOrganiser,
  type BroadcastLink,
} from '@mychess/domain';
import type { LichessBroadcasts } from '../../src/server/lichess-broadcasts';
import {
  tourPgn,
  type FakeTour,
  type FakeTourGame,
} from './lichess-broadcast-api';

/**
 * What a scripted call answers: a refusal, never, or the world's answer
 * (for a refusal followed by success).
 */
export type Scripted = LichessBroadcastRefusal['reason'] | 'hang' | 'world';

export interface InMemoryWorld {
  /** The tournaments Lichess knows, with their games. */
  readonly tours?: readonly {
    readonly tour: FakeTour;
    readonly games?: readonly FakeTourGame[];
  }[];
  /** Each organiser's pages of tournaments, page 1 first. */
  readonly organisers?: Partial<
    Record<ApprovedOrganiser, readonly (readonly FakeTour[])[]>
  >;
  /**
   * Answers by call name (\`page kesnor7 1\`, \`tour VilOpn26\`, \`pasted
   * RoundAA2\`, \`pgn VilOpn26\`), given in turn, the last again after.
   */
  readonly script?: Readonly<Record<string, readonly Scripted[]>>;
}

export interface InMemoryLichessBroadcasts extends LichessBroadcasts {
  /** Every call's name, in order. */
  readonly calls: string[];
}

const instant = (day: string): Date => new Date(`${day}T09:00:00Z`);

/** \`tour\` as the gateway gives it. */
function lichessTour(tour: FakeTour): LichessBroadcastTour {
  const start = tour.dates?.[0];
  const end = tour.dates?.[1];
  return {
    id: tour.id,
    name: tour.name,
    slug: null,
    official: tour.official === true,
    createdAt: instant(start ?? '2026-01-01'),
    dates:
      start === undefined || end === undefined
        ? null
        : { start: instant(start), end: instant(end) },
  };
}

const finished = (tour: FakeTour): boolean =>
  tour.rounds.every((round) => !(tour.running ?? []).includes(round));

/** \`tour\` with its rounds, as the gateway gives it. */
function lichessTourDetail(tour: FakeTour): LichessBroadcastTourDetail {
  return {
    tour: lichessTour(tour),
    rounds: tour.rounds.map((id) => {
      const done = !(tour.running ?? []).includes(id);
      return {
        id,
        startsAt: null,
        finishedAt: null,
        finished: done,
      };
    }),
    finished: tour.rounds.length > 0 && finished(tour),
  };
}

const NOT_FOUND = LICHESS_BROADCAST_REFUSALS.notFound;

/** An in-memory gateway over \`world\`. */
export function inMemoryLichessBroadcasts(
  world: InMemoryWorld = {},
): InMemoryLichessBroadcasts {
  const calls: string[] = [];
  const served = new Map<string, number>();
  const scripted = (name: string): Scripted | undefined => {
    calls.push(name);
    const list = world.script?.[name] ?? [];
    const n = served.get(name) ?? 0;
    served.set(name, n + 1);
    return list[Math.min(n, list.length - 1)];
  };
  const known = (id: string) => world.tours?.find(({ tour }) => tour.id === id);
  const answer = async <T>(
    name: string,
    signal: AbortSignal | undefined,
    value: () => LichessBroadcastResult<T>,
  ): Promise<LichessBroadcastResult<T>> => {
    const script = scripted(name);
    if (script === 'hang') return never(signal);
    return script === undefined || script === 'world'
      ? value()
      : refuse(script);
  };
  const detail = (
    id: string,
  ): LichessBroadcastResult<LichessBroadcastTourDetail> => {
    const found = known(id);
    return found === undefined
      ? refuse(NOT_FOUND)
      : ok(lichessTourDetail(found.tour));
  };
  return {
    calls,
    organiserPage: (organiser, page) =>
      answer(`page ${organiser} ${String(page)}`, undefined, () =>
        ok(organiserPageOf(world, organiser, page)),
      ),
    tour: (tourId) => answer(`tour ${tourId}`, undefined, () => detail(tourId)),
    pastedTour: (link) => {
      const id = link.kind === 'tour' ? link.tourId : link.roundId;
      return answer(`pasted ${id}`, undefined, () => {
        const owner = pastedOwner(world, link);
        return owner === undefined ? refuse(NOT_FOUND) : detail(owner);
      });
    },
    openPgn: (tourId, { signal, idle }) => {
      // Sent at once: no queue in memory.
      idle.arm();
      return answer(`pgn ${tourId}`, signal, () => {
        const found = known(tourId);
        if (found === undefined) return refuse(NOT_FOUND);
        return ok(pgnOf(tourPgn(found.tour, found.games ?? [])));
      });
    },
  };
}

/** Page `page` of `organiser`'s tournaments in `world`. */
function organiserPageOf(
  world: InMemoryWorld,
  organiser: ApprovedOrganiser,
  page: number,
): LichessBroadcastPage {
  const pages = world.organisers?.[organiser] ?? [];
  const tours = pages[page - 1] ?? [];
  return {
    tours: tours.map((tour) => ({
      tour: lichessTour(tour),
      finished: finished(tour),
    })),
    nextPage: page < pages.length ? page + 1 : null,
  };
}

/** The id of the tournament `link` names in `world`, a round's by its rounds. */
function pastedOwner(
  world: InMemoryWorld,
  link: BroadcastLink,
): string | undefined {
  if (link.kind === 'tour') return link.tourId;
  return world.tours?.find(({ tour }) => tour.rounds.includes(link.roundId))
    ?.tour.id;
}

/** An answer that never comes, but fails with the abort of `signal`. */
function never<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });
}

/** A PGN of `text`, read through the dump parser as the real one is. */
function pgnOf(text: string): LichessBroadcastPgn {
  async function* chunks(): AsyncGenerator<string> {
    await Promise.resolve();
    yield text;
  }
  return {
    games: broadcastGames(chunks()),
    close: () => undefined,
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
}
