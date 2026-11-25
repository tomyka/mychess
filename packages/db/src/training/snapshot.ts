/**
 * What the training page starts from (S6 decision 1): the repertoires the
 * player trains, their held Reviews, today's learned count and the
 * player's limits, read in one snapshot. The browser builds the queue and
 * the learn plan from it with chess's pure functions.
 */
import {
  repertoireKeys,
  type RepertoireGraph,
  type ReviewState,
  type Side,
} from '@mychess/chess';
import { dayEnd, dayStart, type TrainingSettings } from '@mychess/domain';
import { REPEATABLE_READ, type Executor } from '../client';
import { isUuid } from '../ids';
import { trainingEntries, type TrainingRepertoireEntry } from './entries';
import { learnedBetween, reviewsOf, type StoredReview } from './reviews';
import { trainingSettings } from './settings';

/** Every repertoire the player trains, or one of them. */
export type TrainingScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'repertoire'; readonly repertoireId: string };

/** Another repertoire the player trains, for the "two answers" notice. */
export interface OtherTrainingRepertoire {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  readonly graph: RepertoireGraph;
}

export interface TrainingSnapshot {
  /** In learnOrder (R-145), paused ones included; one repertoire when scoped to it. */
  readonly entries: readonly TrainingRepertoireEntry[];
  /**
   * Every other repertoire the player trains, paused ones included, so a
   * scoped session still finds the other held repertoires that play a
   * different move in a position (S6 decision 6). Empty for every
   * repertoire: the entries hold them all.
   */
  readonly others: readonly OtherTrainingRepertoire[];
  /**
   * Reviews of keys the player's training repertoires hold (all of them,
   * paused ones included, so a held key is never dormant), by key: dormant
   * ones (R-44) are left out at read time.
   */
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** Tracked keys among them, a Review exists (for learnPlan, R-181). */
  readonly tracked: ReadonlySet<string>;
  /**
   * Held keys whose Review entered by "I know this" (skippedAt set), for the
   * skipped state of R-151; a subset of `tracked`.
   */
  readonly known: ReadonlySet<string>;
  /** Moves learned (not skipped) in the player's day so far (R-147). */
  readonly learnedToday: number;
  readonly settings: TrainingSettings;
}

/** The entries the scope names; undefined when it names none the player trains. */
function scoped(
  entries: readonly TrainingRepertoireEntry[],
  scope: TrainingScope,
): readonly TrainingRepertoireEntry[] | undefined {
  if (scope.kind === 'all') return entries;
  const named = entries.filter((e) => e.repertoire.id === scope.repertoireId);
  return named.length === 0 ? undefined : named;
}

/** The entries of `all` that `entries` leaves out, as others. */
const othersOf = (
  all: readonly TrainingRepertoireEntry[],
  entries: readonly TrainingRepertoireEntry[],
): OtherTrainingRepertoire[] =>
  all
    .filter((entry) => !entries.includes(entry))
    .map(({ repertoire, name, side }) => ({
      id: repertoire.id,
      name,
      side,
      graph: repertoire.graph,
    }));

/** The stored Reviews of keys `held`, as ReviewStates. */
function heldReviews(
  stored: ReadonlyMap<string, StoredReview>,
  held: ReadonlySet<string>,
): Map<string, ReviewState> {
  return new Map(
    [...stored]
      .filter(([key]) => held.has(key))
      .map(([key, { review }]) => [key, review]),
  );
}

/** The keys of `held` whose stored Review entered by "I know this". */
const knownKeys = (
  stored: ReadonlyMap<string, StoredReview>,
  held: ReadonlySet<string>,
): Set<string> =>
  new Set(
    [...stored]
      .filter(([key, { skippedAt }]) => held.has(key) && skippedAt !== null)
      .map(([key]) => key),
  );

/**
 * The player's training snapshot for `scope` at `now`; undefined when the
 * scope names a repertoire the player does not train (another player's, a
 * forked or unassigned one, or a malformed id).
 */
export async function trainingSnapshot(
  db: Executor,
  playerId: string,
  scope: TrainingScope,
  now: Date,
): Promise<TrainingSnapshot | undefined> {
  if (scope.kind === 'repertoire' && !isUuid(scope.repertoireId)) {
    return undefined;
  }
  return db.transaction(async (tx) => {
    const all = await trainingEntries(tx, playerId);
    const entries = scoped(all, scope);
    if (entries === undefined) return undefined;
    const stored = await reviewsOf(tx, playerId);
    const held = repertoireKeys(all.map((e) => e.repertoire));
    const reviews = heldReviews(stored, held);
    return {
      entries,
      others: othersOf(all, entries),
      reviews,
      tracked: new Set(reviews.keys()),
      known: knownKeys(stored, held),
      learnedToday: await learnedBetween(
        tx,
        playerId,
        dayStart(now),
        dayEnd(now),
      ),
      settings: await trainingSettings(tx, playerId),
    };
  }, REPEATABLE_READ);
}
