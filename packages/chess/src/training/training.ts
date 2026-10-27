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
 *    Review. `startReview` is exported for the server, which records a learn
 *    pass the browser finished (S6 decision 1).
 * 3. `buildQueue` offers it again when its Review is Due; `grade` records the
 *    drill: a pass, or a Lapse (a wrong move, or a hint, R-61). A Lapse brings
 *    the move back within minutes the same day (R-78); "continue" offers it
 *    again once it is Due, while `exclude` only holds back new moves already
 *    shown this session.
 * 4. `mastered` (a set of moves, a line or a chapter), `allLearned` (a
 *    whole repertoire, R-129) and `weakSpots` read
 *    progress (R-56); `reconcile` sorts the Reviews after a coach edit or an
 *    unlink (R-23, R-44).
 *
 * Two sessions drive the browser's training screens. The learn session
 * (`startLearnSession`, `playLearn`, `advanceLearn`, `currentLearnStep`)
 * plays a `learnPlan` line's learn pass, an arrows round then a blind
 * round, and emits each new move once learned (R-144, R-55). The review session
 * (`startReviewSession`, `answerReview`, `hintReview`, `nextReview`,
 * `reviewCounts`) asks the queue's Reviews after their line so far, chains
 * into the next Due move of the same repertoire (R-143, R-54) and emits one
 * outcome per move (R-59, R-61). The training day (`training-day.ts`) reads a
 * player's snapshot: the allowance, what is due, when the next Review is,
 * the progress and the screen training starts on. `twoAnswers` names the
 * other answers the player's repertoires give (R-54); `learnAgainKeys` the
 * skipped moves "Learn again" returns (R-147).
 *
 * The ts-fsrs scheduler stays behind this interface (`schedule.ts`).
 */
export { knowThis, learnStep, startLearn } from './learn';
export type { LearnEvent, LearnState } from './learn';
export { allLearned, mastered, reconcile, weakSpots } from './progress';
export type { Reconciliation, WeakSpot } from './progress';
export {
  moveState,
  percentLearned,
  progressOf,
  repertoireStanding,
  totalMoves,
} from './coach-progress';
export type {
  ChapterProgress,
  LineProgress,
  MoveState,
  ProgressCounts,
  RepertoireProgress,
  Standing,
  TrackedReview,
} from './coach-progress';
export { buildQueue, QUEUE_LIMITS } from './queue';
export type {
  Queue,
  QueueInput,
  QueueItem,
  QueueLimits,
  QueueRefusal,
} from './queue';
export { grade, startReview } from './schedule';
export type { Outcome, ReviewState } from './schedule';
export { repertoireKeys } from './scope';
export type { Scope, TrainingRepertoire } from './scope';
export { reviewStateSchema, unreviewed } from './stored-review';
export { lineTo } from './line-to';
export type { LineTo } from './line-to';
export { learnPlan } from './learn-plan';
export type { LearnLine, LearnPlanStep, LearnStepKind } from './learn-plan';
export {
  advanceLearn,
  currentLearnStep,
  playLearn,
  startLearnSession,
} from './learn-session';
export type {
  LearnEmit,
  LearnRound,
  LearnSessionState,
  LearnTransition,
} from './learn-session';
export {
  answerReview,
  hintReview,
  nextReview,
  reviewCounts,
  startReviewSession,
} from './review-session';
export type {
  ReviewEmit,
  ReviewItemView,
  ReviewPhase,
  ReviewSessionState,
  ReviewTransition,
  ReviewCounts,
} from './review-session';
export {
  dueCount,
  dueReviews,
  learnLines,
  newKeys,
  nextDue,
  startState,
  toLearnCount,
  trainingCounts,
  trainingProgress,
} from './training-day';
export type {
  StartState,
  TrainingCounts,
  TrainingDay,
  TrainingMode,
  TrainingProgress,
} from './training-day';
export { learnAgainKeys, twoAnswers } from './answers';
export type { OtherAnswer } from './answers';
