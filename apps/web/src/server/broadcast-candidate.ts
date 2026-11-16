/**
 * What the domain's qualifyBroadcastTour reads of a tournament Lichess
 * gave (#349) in an approved organiser's list.
 */
import type {
  ApprovedOrganiser,
  BroadcastTourCandidate,
} from '@mychess/domain';
import type { LichessBroadcastTour } from '@mychess/integrations';

/**
 * When `tour`'s last round starts, as the domain reads it: Lichess's last
 * date; null when Lichess gives no dates. The one place this mapping is
 * made, for qualifying a tour and for paging an organiser's list.
 */
export function tourLastRoundAt(tour: LichessBroadcastTour): Date | null {
  return tour.dates?.end ?? null;
}

/**
 * `tour` as a candidate; one without a last round is refused by
 * qualifyBroadcastTour.
 */
export function tourCandidate(
  tour: LichessBroadcastTour,
  finished: boolean,
  organiser: ApprovedOrganiser,
): BroadcastTourCandidate {
  return {
    id: tour.id,
    name: tour.name,
    official: tour.official,
    finished,
    lastRoundAt: tourLastRoundAt(tour),
    organiser,
  };
}
