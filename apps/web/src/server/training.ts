// What the training page starts from (S6 decision 1): the session
// account's snapshot as plain data the browser builds its queue and learn
// plan from. The page reads the database only through this loader, which
// starts from the session account: a value from the URL only narrows the
// scope, and the snapshot query checks it is a repertoire the player trains.
import {
  nextDue,
  trainingCounts,
  type TrainingCounts,
  type TrainingMode,
} from '@mychess/chess';
import {
  coachNotesOn,
  forkCoachNotesOn,
  trainingSnapshot,
  type TrainingScope,
  type TrainingSnapshot,
} from '@mychess/db';
import {
  SECONDS_PER_REVIEW,
  type Account,
  type OwnCoachNote,
} from '@mychess/domain';
import { z } from 'zod';
import { dayOf } from '../lib/training-day';
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

/** The training data the snapshot holds: all of it but the coach notes. */
type SnapshotData = Omit<TrainingData, 'coachNotes'>;

/** A note read from the db, as the browser gets it: no coach account id. */
const ownNote =
  (repertoireId: string, source: OwnCoachNote['source']) =>
  (
    note: Pick<OwnCoachNote, 'moveKey' | 'coachName' | 'text'>,
  ): OwnCoachNote => ({
    repertoireId,
    moveKey: note.moveKey,
    coachName: note.coachName,
    text: note.text,
    source,
  });

/**
 * The coach notes on the session account's own repertoire `repertoireId`:
 * the one its fork kept, and each sharing coach's. Both reads filter by
 * owner.
 */
async function ownCoachNotes(
  account: Account,
  repertoireId: string,
): Promise<OwnCoachNote[]> {
  const [kept, shared] = await Promise.all([
    forkCoachNotesOn(getDb(), account.id, repertoireId),
    coachNotesOn(getDb(), account.id, repertoireId),
  ]);
  return [
    ...kept.map(ownNote(repertoireId, 'fork')),
    ...shared.map(ownNote(repertoireId, 'shared')),
  ];
}

/**
 * The session account's training data for `scope`, or undefined when the
 * scope names a repertoire they do not train (the page's 404). The coach
 * notes are read for their own repertoires only: an assigned one's are its
 * comments (R-102), named with its entry's coachName.
 */
export async function loadTraining(
  account: Account,
  mode: TrainingMode,
  scope: TrainingScope,
): Promise<TrainingData | undefined> {
  const data = await snapshotData(account, mode, scope);
  if (data === undefined) return undefined;
  const own = data.entries.filter((entry) => entry.kind === 'own');
  const notes = await Promise.all(
    own.map((entry) => ownCoachNotes(account, entry.id)),
  );
  return { ...data, coachNotes: notes.flat() };
}

type SnapshotEntry = TrainingSnapshot['entries'][number];

/**
 * A snapshot entry as plain data. The snapshot names the coach of every
 * assigned entry (it throws otherwise), so a missing name is a programmer
 * error here too.
 */
function dataEntry(entry: SnapshotEntry): TrainingData['entries'][number] {
  const { repertoire, name, side } = entry;
  const base = {
    id: repertoire.id,
    name,
    side,
    active: repertoire.active,
    graph: repertoire.graph,
  };
  if (entry.kind === 'own') return { ...base, kind: 'own' };
  if (entry.coachName === null)
    throw new Error('an assigned training entry names its coach');
  return { ...base, kind: 'assigned', coachName: entry.coachName };
}

/** The session account's snapshot for `scope` as plain data, read now. */
async function snapshotData(
  account: Account,
  mode: TrainingMode,
  scope: TrainingScope,
): Promise<SnapshotData | undefined> {
  const now = new Date();
  const snapshot = await trainingSnapshot(getDb(), account.id, scope, now);
  if (snapshot === undefined) return undefined;
  return {
    mode,
    entries: snapshot.entries.map(dataEntry),
    others: snapshot.others.map(({ id, name, side, graph }) => ({
      id,
      name,
      side,
      graph,
    })),
    reviews: [...snapshot.reviews.values()],
    tracked: [...snapshot.tracked],
    learnedToday: snapshot.learnedToday,
    settings: snapshot.settings,
    now,
  };
}

/** Home's "Today" block (U1-M1-3): what is due and to learn, before starting. */
export interface TodaySummary extends TrainingCounts {
  /** The estimated minutes the due moves take, rounded up. */
  readonly minutes: number;
  /** The earliest Review due after now, or null. */
  readonly nextDue: Date | null;
}

/**
 * The session account's "Today" block over every repertoire they train
 * (R-142): every due move, not a session's worth, and the new moves today's
 * allowance leaves (R-146).
 */
export async function todaySummary(account: Account): Promise<TodaySummary> {
  const data = await snapshotData(account, 'review', { kind: 'all' });
  if (data === undefined)
    return { due: 0, toLearn: 0, minutes: 0, nextDue: null };
  const day = dayOf(data);
  const counts = trainingCounts(day, data.now);
  return {
    ...counts,
    minutes: Math.ceil((counts.due * SECONDS_PER_REVIEW) / 60),
    nextDue: nextDue(day, data.now),
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
  const data = await snapshotData(account, 'review', {
    kind: 'repertoire',
    repertoireId,
  });
  return data === undefined ? null : trainingCounts(dayOf(data), data.now);
}
