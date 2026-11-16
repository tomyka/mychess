/**
 * What the domain's qualifyBroadcastTour reads of a tournament Lichess
 * gave (#349), whether listed for an organiser or named by a pasted link.
 */
import type {
  BroadcastTourCandidate,
  BroadcastTourOrigin,
} from '@mychess/domain';
import type { LichessBroadcastTour } from '@mychess/integrations';

/**
 * `tour` as a candidate: its last round is Lichess's last date, none when
 * Lichess gives no dates (qualifyBroadcastTour then refuses it).
 */
export function tourCandidate(
  tour: LichessBroadcastTour,
  finished: boolean,
  origin: BroadcastTourOrigin,
): BroadcastTourCandidate {
  return {
    id: tour.id,
    name: tour.name,
    official: tour.official,
    finished,
    lastRoundAt: tour.dates?.end ?? null,
    origin,
  };
}
