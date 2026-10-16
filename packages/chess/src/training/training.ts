/**
 * Training over a player's repertoires and Reviews (ADR-0004): the module's
 * whole interface. Every function is pure, takes the time it needs and
 * returns new values; the caller stores the Reviews it gets back.
 *
 * The lifecycle of a player move, in the only order these functions allow:
 *
 * 1. `buildQueue` offers it as a new move (R-62: daily allowance, active
 *    repertoires only, R-46; one Review per key, R-53; each item names the
 *    repertoire that asks for it, R-54, and the expected move).
 * 2. `startLearn` and `learnStep` run its learn pass (R-55): arrow shown, then
 *    asked blind; a wrong answer shows the arrow again. The `learned` state
 *    carries the move's first Review, due the next day. `knowThis` (R-58)
 *    skips the pass for a move, a line or a chapter, with the same first
 *    Review.
 * 3. `buildQueue` offers it again when its Review is Due; `grade` records the
 *    drill: a pass, or a Lapse (a wrong move, or a hint, R-61). A Lapse brings
 *    the move back within minutes the same day (R-78).
 * 4. `mastered` (a set of moves, a line or a chapter) and `weakSpots` read
 *    progress (R-56); `reconcile` sorts the Reviews after a coach edit or an
 *    unlink (R-23, R-44).
 *
 * The ts-fsrs scheduler stays behind this interface (`schedule.ts`).
 */
export { knowThis, learnStep, startLearn } from './learn';
export type { LearnEvent, LearnState } from './learn';
export { mastered, reconcile, weakSpots } from './progress';
export type { Reconciliation, WeakSpot } from './progress';
export { buildQueue, QUEUE_LIMITS } from './queue';
export type {
  Queue,
  QueueInput,
  QueueItem,
  QueueLimits,
  QueueRefusal,
} from './queue';
export { grade } from './schedule';
export type { Outcome, ReviewState } from './schedule';
export type { Scope, TrainingRepertoire } from './scope';
