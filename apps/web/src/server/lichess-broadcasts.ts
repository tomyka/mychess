/**
 * The Lichess broadcast gateway (#349): what this process asks the
 * Lichess broadcast API, by intent, one gateway per process
 * (fide-services.ts). Callers say what they want; the gateway owns how:
 *
 * - the owner's token (R-199), on every call;
 * - the pace (lichess-pace.ts, its private implementation): one request
 *   at a time a second apart, every call held a minute after a 429;
 * - the lanes: the night's listing and a tournament's detail, and the
 *   runner's PGN downloads, go before pasted links (security M1d);
 * - the time limits: a night or paste call gets 15 s from its turn; a
 *   pasted link at most PASTE_WAIT_MS in all, its queue wait included; a
 *   PGN only the runner's limits, its idle limit armed as it is sent.
 *
 * Every expected failure is a refusal value (LICHESS_BROADCAST_REFUSALS):
 * a 429 is \`rateLimited\`, for the night to decide whether to go on; a
 * call that ran out of time is \`unavailable\`.
 */
import {
  refuse,
  type ApprovedOrganiser,
  type BroadcastLink,
  type BroadcastTourId,
} from '@mychess/domain';
import {
  LICHESS_BROADCAST_REFUSALS,
  lichessBroadcastsBy,
  lichessBroadcastTour,
  lichessBroadcastTourOfRound,
  openLichessBroadcastPgn,
  type Fetch,
  type LichessApi,
  type LichessBroadcastPage,
  type LichessBroadcastPgn,
  type LichessBroadcastResult,
  type LichessBroadcastTourDetail,
} from '@mychess/integrations';
import type { IdleLimit } from './broadcast-limits';
import {
  createLichessPacer,
  LICHESS_PACE,
  NO_ABORT,
  sleep,
} from './lichess-pace';

/**
 * How long a pasted link may take in all, its wait in the queue included:
 * pastes go behind the night's calls and a 429 pause, so without it the
 * page could say "Adding…" for minutes.
 */
export const PASTE_WAIT_MS = 30_000;

/** What a PGN download is held to: the runner's signal and idle limit. */
interface PgnDownload {
  readonly signal: AbortSignal;
  /** Armed by the gateway as the request is sent. */
  readonly idle: IdleLimit;
}

export interface LichessBroadcasts {
  /** Page \`page\` of \`organiser\`'s tournaments, newest first. */
  organiserPage(
    organiser: ApprovedOrganiser,
    page: number,
  ): Promise<LichessBroadcastResult<LichessBroadcastPage>>;
  /** The queued tournament \`tourId\` with its rounds. */
  tour(
    tourId: BroadcastTourId,
  ): Promise<LichessBroadcastResult<LichessBroadcastTourDetail>>;
  /**
   * The tournament a pasted link names, a round's resolved first, with its
   * rounds; \`unavailable\` once PASTE_WAIT_MS have passed.
   */
  pastedTour(
    link: BroadcastLink,
  ): Promise<LichessBroadcastResult<LichessBroadcastTourDetail>>;
  /**
   * Opens \`tourId\`'s PGN under \`download\`: the gateway arms its idle limit
   * as the request is sent, so a wait in the queue never counts as idle.
   * Close it, or \`await using\` it, once done.
   */
  openPgn(
    tourId: BroadcastTourId,
    download: PgnDownload,
  ): Promise<LichessBroadcastResult<LichessBroadcastPgn>>;
}

export interface LichessBroadcastsDeps {
  readonly fetch: Fetch;
  /** A Lichess personal token with the study:read scope (R-199). */
  readonly token: string;
  /** Milliseconds, as Date.now gives them; Date.now unless a test asks. */
  readonly clock?: () => number;
  /** A signal aborted \`ms\` from now; AbortSignal.timeout unless a test asks. */
  readonly timeout?: (ms: number) => AbortSignal;
}

const UNAVAILABLE = LICHESS_BROADCAST_REFUSALS.unavailable;

/** The gateway over \`fetch\` with \`token\`, its queue empty. */
export function createLichessBroadcasts(
  deps: LichessBroadcastsDeps,
): LichessBroadcasts {
  const timeout = deps.timeout ?? ((ms: number) => AbortSignal.timeout(ms));
  const pacer = createLichessPacer(deps.fetch, {
    ...LICHESS_PACE,
    sleep,
    clock: deps.clock ?? (() => Date.now()),
    timeout,
  });
  const night: LichessApi = { fetch: pacer.fetch('night'), token: deps.token };
  const paste: LichessApi = { fetch: pacer.fetch('paste'), token: deps.token };
  return {
    organiserPage: (organiser, page) =>
      lichessBroadcastsBy(night, organiser, page, NO_ABORT),
    tour: (tourId) => lichessBroadcastTour(night, tourId, NO_ABORT),
    pastedTour: (link) => pastedTour(paste, link, timeout(PASTE_WAIT_MS)),
    openPgn: (tourId, { signal, idle }) =>
      openLichessBroadcastPgn(
        {
          fetch: pacer.fetch('download', () => {
            idle.arm();
          }),
          token: deps.token,
        },
        tourId,
        signal,
      ),
  };
}

/**
 * The tournament \`link\` names, with its rounds, both calls bounded by
 * \`deadline\`: once it aborts, a call still queued leaves the queue, and
 * the answer is \`unavailable\`.
 */
async function pastedTour(
  api: LichessApi,
  link: BroadcastLink,
  deadline: AbortSignal,
): Promise<LichessBroadcastResult<LichessBroadcastTourDetail>> {
  try {
    const tourId =
      link.kind === 'tour'
        ? link.tourId
        : await roundTourId(api, link.roundId, deadline);
    if (typeof tourId !== 'string') return tourId;
    return await lichessBroadcastTour(api, tourId, deadline);
  } catch (error) {
    if (deadline.aborted) return refuse(UNAVAILABLE);
    throw error;
  }
}

/** The id of the tournament round \`roundId\` belongs to, or the refusal. */
async function roundTourId(
  api: LichessApi,
  roundId: string,
  deadline: AbortSignal,
): Promise<string | LichessBroadcastResult<never>> {
  const tour = await lichessBroadcastTourOfRound(api, roundId, deadline);
  return tour.ok ? tour.value.id : tour;
}
