/**
 * The Lichess broadcast gateway (#349): what this process asks the
 * Lichess broadcast API, by intent, one gateway per process
 * (fide-services.ts). Callers say what they want; the gateway owns how:
 *
 * - the owner's token (R-199), on every call;
 * - the pace (lichess-pace.ts, its private implementation): one request
 *   at a time a second apart, every call held a minute after a 429;
 * - the time limits: the night's listing and a tournament's detail get
 *   15 s each from their turn; a PGN only the runner's limits, its idle
 *   limit armed as it is sent.
 *
 * Every expected failure is a refusal value (LICHESS_BROADCAST_REFUSALS):
 * a 429 is `rateLimited`, for the night to decide whether to go on; a
 * call that ran out of time is `unavailable`.
 */
import type { ApprovedOrganiser, BroadcastTourId } from '@mychess/domain';
import {
  lichessBroadcastsBy,
  lichessBroadcastTour,
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

/** What a PGN download is held to: the runner's signal and idle limit. */
interface PgnDownload {
  readonly signal: AbortSignal;
  /** Armed by the gateway as the request is sent. */
  readonly idle: IdleLimit;
}

export interface LichessBroadcasts {
  /** Page `page` of `organiser`'s tournaments, newest first. */
  organiserPage(
    organiser: ApprovedOrganiser,
    page: number,
  ): Promise<LichessBroadcastResult<LichessBroadcastPage>>;
  /** The queued tournament `tourId` with its rounds. */
  tour(
    tourId: BroadcastTourId,
  ): Promise<LichessBroadcastResult<LichessBroadcastTourDetail>>;
  /**
   * Opens `tourId`'s PGN under `download`: the gateway arms its idle limit
   * as the request is sent, so a wait in the queue never counts as idle.
   * Close it, or `await using` it, once done.
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
  /** A signal aborted `ms` from now; AbortSignal.timeout unless a test asks. */
  readonly timeout?: (ms: number) => AbortSignal;
}

/** The gateway over `fetch` with `token`, its queue empty. */
export function createLichessBroadcasts(
  deps: LichessBroadcastsDeps,
): LichessBroadcasts {
  const pacer = createLichessPacer(deps.fetch, {
    ...LICHESS_PACE,
    sleep,
    clock: deps.clock ?? (() => Date.now()),
    timeout: deps.timeout ?? ((ms: number) => AbortSignal.timeout(ms)),
  });
  const night: LichessApi = { fetch: pacer.fetch('night'), token: deps.token };
  return {
    organiserPage: (organiser, page) =>
      lichessBroadcastsBy(night, organiser, page, NO_ABORT),
    tour: (tourId) => lichessBroadcastTour(night, tourId, NO_ABORT),
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
