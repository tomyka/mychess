/**
 * The repositories Opponent's games uses, bound to one database (#316,
 * #349): what the composition root (fide-services.ts) hands the use cases
 * and the runner. The database adapter is fideStoreOn; the use cases'
 * tests pass plain fakes.
 */
import {
  broadcastMonthStatuses,
  broadcastTourStatuses,
  countRateLimited,
  gamesForFideId,
  queueBroadcastTour,
  type BroadcastMonthEntry,
  type BroadcastTourEntry,
  type Executor,
} from '@mychess/db';
import type {
  BroadcastMonth,
  BroadcastWindow,
  QueuedBroadcastTour,
} from '@mychess/domain';
import { broadcastIndexOn, type BroadcastIndex } from './broadcast-runner';
import {
  broadcastTourIndexOn,
  type BroadcastTourIndex,
} from './broadcast-tour-job';
import type { CountRequest } from './count-request';
import type { SearchStore } from './fide-search';

export interface FideStore extends SearchStore {
  readonly count: CountRequest;
  readonly monthStatuses: (
    months: readonly BroadcastMonth[],
  ) => Promise<BroadcastMonthEntry[]>;
  /** Queues a tournament; true when it was new (queueBroadcastTour). */
  readonly queueTour: (tour: QueuedBroadcastTour) => Promise<boolean>;
  /** The queued tournaments of `window` (broadcastTourStatuses). */
  readonly tourStatuses: (
    window: BroadcastWindow,
  ) => Promise<BroadcastTourEntry[]>;
  /** The month index the runner claims, writes and fails. */
  readonly monthIndex: BroadcastIndex;
  /** The tournament index the runner claims, writes and fails. */
  readonly tourIndex: BroadcastTourIndex;
}

/** The repositories on `db`. */
export function fideStoreOn(db: Executor): FideStore {
  return {
    count: (key, rule, now) => countRateLimited(db, key, rule, now),
    monthStatuses: (months) => broadcastMonthStatuses(db, months),
    games: (id, scope) => gamesForFideId(db, id, scope),
    queueTour: (tour) => queueBroadcastTour(db, tour),
    tourStatuses: (window) => broadcastTourStatuses(db, window),
    monthIndex: broadcastIndexOn(db),
    tourIndex: broadcastTourIndexOn(db),
  };
}
