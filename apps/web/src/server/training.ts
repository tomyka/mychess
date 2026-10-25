// What the training page starts from (S6 decision 1): the session
// account's snapshot as plain data the browser builds its queue and learn
// plan from. The page reads the database only through this loader, which
// starts from the session account: a value from the URL only narrows the
// scope, and the snapshot query checks it is a repertoire the player trains.
import { trainingSnapshot, type TrainingScope } from '@mychess/db';
import { SECONDS_PER_REVIEW, type Account } from '@mychess/domain';
import { z } from 'zod';
import type { TrainingMode } from '../lib/routes';
import { trainingCounts, type TrainingCounts } from '../lib/training-counts';
import type { TrainingData } from '../lib/training-data';
import { getDb } from './db';

const searchSchema = z.object({
  mode: z.enum(['review', 'learn']).catch('review'),
  r: z.uuid().optional().catch(undefined),
});

/** The page's search params: an unknown mode is a review, a bad `r` is dropped. */
export function parseTrainingSearch(
  params: Readonly<Record<string, string | string[] | undefined>>,
): { readonly mode: TrainingMode; readonly scope: TrainingScope } {
  const { mode, r } = searchSchema.parse(params);
  return {
    mode,
    scope:
      r === undefined
        ? { kind: 'all' }
        : { kind: 'repertoire', repertoireId: r },
  };
}

/**
 * The session account's training data for `scope`, or undefined when the
 * scope names a repertoire they do not train (the page's 404).
 */
export async function loadTraining(
  account: Account,
  mode: TrainingMode,
  scope: TrainingScope,
): Promise<TrainingData | undefined> {
  const now = new Date();
  const snapshot = await trainingSnapshot(getDb(), account.id, scope, now);
  if (snapshot === undefined) return undefined;
  return {
    mode,
    entries: snapshot.entries.map(({ repertoire, name, side, kind }) => ({
      id: repertoire.id,
      name,
      side,
      kind,
      active: repertoire.active,
      graph: repertoire.graph,
    })),
    others: snapshot.others.map(({ id, name, side, graph }) => ({
      id,
      name,
      side,
      graph,
    })),
    reviews: [...snapshot.reviews.values()],
    learned: [...snapshot.learned],
    learnedToday: snapshot.learnedToday,
    settings: snapshot.settings,
    nextDue: snapshot.nextDue,
    now,
  };
}

/** Home's "Today" block (U1-M1-3): what is due and to learn, before starting. */
export interface TodaySummary extends TrainingCounts {
  /** The estimated minutes the due moves take, rounded up. */
  readonly minutes: number;
  /** The earliest due among the active repertoires' Reviews, or null. */
  readonly nextDue: Date | null;
}

/**
 * The session account's "Today" block over every repertoire they train
 * (R-142): every due move, not a session's worth, and the new moves today's
 * allowance leaves (R-146).
 */
export async function todaySummary(account: Account): Promise<TodaySummary> {
  const data = await loadTraining(account, 'review', { kind: 'all' });
  if (data === undefined)
    return { due: 0, toLearn: 0, minutes: 0, nextDue: null };
  const counts = trainingCounts(data);
  return {
    ...counts,
    minutes: Math.ceil((counts.due * SECONDS_PER_REVIEW) / 60),
    nextDue: data.nextDue,
  };
}

/**
 * The session account's due and to-learn counts for one repertoire, for its
 * page's train buttons; null when they do not train it.
 */
export async function repertoireTraining(
  account: Account,
  repertoireId: string,
): Promise<TrainingCounts | null> {
  const data = await loadTraining(account, 'review', {
    kind: 'repertoire',
    repertoireId,
  });
  return data === undefined ? null : trainingCounts(data);
}
