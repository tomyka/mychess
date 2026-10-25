// What the training page starts from (S6 decision 1): the session
// account's snapshot as plain data the browser builds its queue and learn
// plan from. The page reads the database only through this loader, which
// starts from the session account: a value from the URL only narrows the
// scope, and the snapshot query checks it is a repertoire the player trains.
import type { RepertoireGraph, ReviewState, Side } from '@mychess/chess';
import { trainingSnapshot, type TrainingScope } from '@mychess/db';
import type { Account, TrainingSettings } from '@mychess/domain';
import { z } from 'zod';
import type { TrainingMode } from '../lib/routes';
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

/** One repertoire the player trains, as the browser needs it. */
interface TrainingDataEntry {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  /** False while its assignment is paused: no new Moves from it. */
  readonly active: boolean;
  readonly graph: RepertoireGraph;
}

/** What the training page sends the browser: plain data only. */
export interface TrainingData {
  readonly mode: TrainingMode;
  /** In the learn order (R-145). */
  readonly entries: readonly TrainingDataEntry[];
  /** The held Reviews (dormant ones left out). */
  readonly reviews: readonly ReviewState[];
  /** Keys learned or skipped among them. */
  readonly learned: readonly string[];
  /** Moves learned in the player's day so far (R-147). */
  readonly learnedToday: number;
  readonly settings: TrainingSettings;
  /** The earliest due of the active entries' Reviews, for the empty state. */
  readonly nextDue: Date | null;
  /** The instant the snapshot was read at. */
  readonly now: Date;
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
    entries: snapshot.entries.map(({ repertoire, name, side }) => ({
      id: repertoire.id,
      name,
      side,
      active: repertoire.active,
      graph: repertoire.graph,
    })),
    reviews: [...snapshot.reviews.values()],
    learned: [...snapshot.learned],
    learnedToday: snapshot.learnedToday,
    settings: snapshot.settings,
    nextDue: snapshot.nextDue,
    now,
  };
}
