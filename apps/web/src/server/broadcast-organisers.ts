/**
 * The nightly listing of the approved organisers' broadcast tournaments
 * (#349, spec decisions 2 and 3; R-196, R-200): each organiser's list,
 * page 1 and then further pages until a page holds only tournaments older
 * than the window, every finished tournament the domain qualifies queued.
 *
 * Pages come from the Lichess gateway (lichess-broadcasts.ts), which
 * paces and times each request and holds the next one a minute after a
 * 429. On a 429 (its `rateLimited` refusal) the listing asks again; on a
 * second it stops for the night. An organiser Lichess
 * refuses, or one whose listing fails, is logged by its refusal or as
 * logText says, and the next organiser is listed.
 */
import {
  APPROVED_BROADCAST_ORGANISERS,
  isBeforeBroadcastWindow,
  qualifyBroadcastTour,
  tourListingDate,
  type ApprovedOrganiser,
  type BroadcastWindow,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import {
  LICHESS_BROADCAST_REFUSALS,
  type LichessBroadcastResult,
  type LichessListedTour,
} from '@mychess/integrations';
import { tourCandidate, tourLastRoundAt } from './broadcast-candidate';
import type { LichessBroadcasts } from './lichess-broadcasts';
import { logText } from './log-text';

export interface OrganiserListingDeps {
  readonly broadcasts: Pick<LichessBroadcasts, 'organiserPage'>;
  /** Queues a tournament; true when it was new to the index. */
  readonly queue: (tour: QueuedBroadcastTour) => Promise<boolean>;
}

/** How many tournaments were new to the index; whether a 429 stopped it. */
export interface OrganiserListing {
  readonly queued: number;
  readonly stopped: boolean;
}

/** One night's listing as it goes. */
interface Night {
  readonly deps: OrganiserListingDeps;
  readonly window: BroadcastWindow;
  readonly now: Date;
  queued: number;
  rateLimited: boolean;
  stopped: boolean;
}

/** Lists every approved organiser at `now`, queuing what qualifies. */
export async function listOrganiserTours(
  deps: OrganiserListingDeps,
  window: BroadcastWindow,
  now: Date,
): Promise<OrganiserListing> {
  const night: Night = {
    deps,
    window,
    now,
    queued: 0,
    rateLimited: false,
    stopped: false,
  };
  for (const organiser of APPROVED_BROADCAST_ORGANISERS) {
    await listSafely(night, organiser);
    if (night.stopped) {
      console.warn(
        'fide: organiser listing stopped for the night on a second 429',
      );
      break;
    }
  }
  return { queued: night.queued, stopped: night.stopped };
}

/** Lists `organiser`; a failure is logged as logText says (log-text.ts). */
async function listSafely(
  night: Night,
  organiser: ApprovedOrganiser,
): Promise<void> {
  try {
    await listOrganiser(night, organiser);
  } catch (error) {
    console.warn(`fide: organiser ${organiser} not listed`, logText(error));
  }
}

async function listOrganiser(
  night: Night,
  organiser: ApprovedOrganiser,
): Promise<void> {
  const { broadcasts } = night.deps;
  for (let page: number | null = 1; page !== null && !night.stopped;) {
    const at: number = page;
    const answer = await patiently(night, () =>
      broadcasts.organiserPage(organiser, at),
    );
    if (answer === undefined) return;
    if (!answer.ok) {
      console.warn(
        `fide: organiser ${organiser} not listed`,
        answer.refusal.reason,
      );
      return;
    }
    await queueQualifying(night, organiser, answer.value.tours);
    page = allBeforeWindow(answer.value.tours, night.window)
      ? null
      : answer.value.nextPage;
  }
}

/**
 * `request`'s answer, asked again after a first 429 (the gateway holds
 * it a minute); undefined, with the night stopped, on a second.
 */
async function patiently<T>(
  night: Night,
  request: () => Promise<LichessBroadcastResult<T>>,
): Promise<LichessBroadcastResult<T> | undefined> {
  for (;;) {
    const answer = await request();
    if (
      answer.ok ||
      answer.refusal.reason !== LICHESS_BROADCAST_REFUSALS.rateLimited
    ) {
      return answer;
    }
    if (night.rateLimited) {
      night.stopped = true;
      return undefined;
    }
    night.rateLimited = true;
  }
}

async function queueQualifying(
  night: Night,
  organiser: ApprovedOrganiser,
  tours: readonly LichessListedTour[],
): Promise<void> {
  for (const listed of tours) {
    const candidate = tourCandidate(listed.tour, listed.finished, {
      kind: 'organiser',
      organiser,
    });
    const qualified = qualifyBroadcastTour(candidate, night.window, night.now);
    if (qualified.ok && (await night.deps.queue(qualified.value))) {
      night.queued += 1;
    }
  }
}

/**
 * Whether every tournament of a page is older than the window (the
 * domain's isBeforeBroadcastWindow), so the pages after it, older still,
 * need not be read.
 */
function allBeforeWindow(
  tours: readonly LichessListedTour[],
  window: BroadcastWindow,
): boolean {
  return tours.every(({ tour }) =>
    isBeforeBroadcastWindow(
      tourListingDate({
        lastRoundAt: tourLastRoundAt(tour),
        createdAt: tour.createdAt,
      }),
      window,
    ),
  );
}
