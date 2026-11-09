// Where the player's day stands once a session is over (#319): moves still
// due now are a "continue" (R-62), a move coming back later today is
// named with its time (R-78), and otherwise today's review is done.
import type { TrainingProgress } from '@mychess/chess';
import { dayEnd } from '@mychess/domain';

export type DayStanding =
  /** Moves due now that the session left: the session can go on. */
  | { readonly kind: 'due'; readonly count: number }
  /** Nothing due now, but a move comes back before the day ends. */
  | { readonly kind: 'laterToday'; readonly next: Date }
  /** Nothing comes back today; `next` is the first review after it, if any. */
  | { readonly kind: 'dayDone'; readonly next: Date | null };

/** Where the day stands at `now`, by the repertoires' `progress`. */
export function dayStanding(
  progress: Pick<TrainingProgress, 'due' | 'nextDue'>,
  now: Date,
): DayStanding {
  const { due, nextDue } = progress;
  if (due > 0) return { kind: 'due', count: due };
  if (nextDue !== null && nextDue.getTime() < dayEnd(now).getTime())
    return { kind: 'laterToday', next: nextDue };
  return { kind: 'dayDone', next: nextDue };
}
