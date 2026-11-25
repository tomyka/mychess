import 'server-only';
// What the training page starts from (S6 decision 1): the session
// account's snapshot as plain data the browser builds its queue and learn
// plan from. The page reads the database only through this loader, which
// starts from the session account: a value from the URL only narrows the
// scope, and the snapshot query checks it is a repertoire the player trains.
import {
  nextDue,
  repertoireLearn,
  todayRows,
  trackedIn,
  trainingCounts,
  type LearnFocus,
  type Side,
  type TodayRow,
  type TrainingCounts,
  type TrainingDay,
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
  type RepertoireKind,
} from '@mychess/domain';
import { cache } from 'react';
import { z } from 'zod';
import type { LearnScope } from '../lib/learn-scope';
import { CHAPTER_PARAM, LINE_PARAM } from '../lib/routes';
import { trainingDay } from '../lib/training-day';
import type { TrainingData } from '../lib/training-data';
import { getDb } from './db';
import { chapterIdSchema } from './repertoire-edit';

const searchSchema = z.object({
  mode: z.enum(['review', 'learn']).catch('review'),
  r: z.uuid().optional().catch(undefined),
  /** A chapter id, as the repertoire page's `?chapter=` takes one. */
  [CHAPTER_PARAM]: chapterIdSchema.optional().catch(undefined),
  /** A line's index in its chapter: digits only. */
  [LINE_PARAM]: z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .optional()
    .catch(undefined),
});

/** The focus the URL names: learn only, in the scoped repertoire, with a chapter. */
function focusOf(
  mode: TrainingMode,
  repertoireId: string | undefined,
  chapterId: string | undefined,
  lineIndex: number | undefined,
): LearnFocus | null {
  if (mode !== 'learn' || repertoireId === undefined || chapterId === undefined)
    return null;
  return {
    repertoireId,
    chapterId,
    ...(lineIndex === undefined ? {} : { lineIndex }),
  };
}

/**
 * The page's search params (R-142, R-206): an unknown mode is a review; a
 * bad `r`, chapter or line is dropped.
 */
export function parseTrainingSearch(
  params: Readonly<Record<string, string | string[] | undefined>>,
): {
  readonly mode: TrainingMode;
  readonly scope: TrainingScope;
  readonly focus: LearnFocus | null;
} {
  const { mode, r, chapter, line } = searchSchema.parse(params);
  return {
    mode,
    scope:
      r === undefined
        ? { kind: 'all' }
        : { kind: 'repertoire', repertoireId: r },
    focus: focusOf(mode, r, chapter, line),
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

/** A snapshot of the session account's training, and the instant it was read at. */
interface SnapshotRead {
  readonly snapshot: TrainingSnapshot;
  readonly now: Date;
}

/** The session account's snapshot for `scope`, read now. */
async function readSnapshot(
  account: Account,
  scope: TrainingScope,
): Promise<SnapshotRead | undefined> {
  const now = new Date();
  const snapshot = await trainingSnapshot(getDb(), account.id, scope, now);
  return snapshot === undefined ? undefined : { snapshot, now };
}

/**
 * The training day a snapshot holds, built from its Maps and Sets by the
 * builder the browser's `dayOf` uses too (lib/training-day.ts), without the
 * plain-data arrays the page's payload needs.
 */
const snapshotDay = (snapshot: TrainingSnapshot): TrainingDay =>
  trainingDay({
    repertoires: snapshot.entries.map(({ repertoire }) => ({
      id: repertoire.id,
      graph: repertoire.graph,
      active: repertoire.active,
    })),
    reviews: snapshot.reviews.values(),
    tracked: snapshot.tracked,
    knownWithoutLearning: snapshot.knownWithoutLearning,
    learnedToday: snapshot.learnedToday,
    settings: snapshot.settings,
  });

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

/** A snapshot as the plain data the browser gets, for `mode`. */
function snapshotData(
  { snapshot, now }: SnapshotRead,
  mode: TrainingMode,
): SnapshotData {
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
    knownWithoutLearning: [...snapshot.knownWithoutLearning],
    learnedToday: snapshot.learnedToday,
    settings: snapshot.settings,
    now,
  };
}

/**
 * The session account's training data for `scope`, or undefined when the
 * scope names a repertoire they do not train (the page's 404). The coach
 * notes are read for their own repertoires only: an assigned one's are its
 * comments (R-102), named with its entry's coachName. A `focus` (R-206)
 * narrows what a learn session plans; one the repertoire does not have
 * plans nothing.
 */
export async function loadTraining(
  account: Account,
  mode: TrainingMode,
  scope: TrainingScope,
  focus: LearnFocus | null = null,
): Promise<TrainingData | undefined> {
  const read = await readSnapshot(account, scope);
  if (read === undefined) return undefined;
  const data = snapshotData(read, mode);
  const own = data.entries.filter((entry) => entry.kind === 'own');
  const notes = await Promise.all(
    own.map((entry) => ownCoachNotes(account, entry.id)),
  );
  return {
    ...data,
    coachNotes: notes.flat(),
    ...(focus === null ? {} : { focus }),
  };
}

/**
 * The session account's snapshot over every repertoire they train, read
 * once per request: Today's summary, Today's list and the shell's badge
 * share the one query. `cache` matches arguments by identity, which holds:
 * `getAccount` (server/session.ts) is itself request-cached, so every
 * caller in a request passes the same Account object.
 */
const allSnapshot = cache((account: Account) =>
  readSnapshot(account, { kind: 'all' }),
);

/** Today's summary (U1-M1-3): what is due and to learn, before starting. */
export interface TodaySummary extends TrainingCounts {
  /** The estimated minutes the due moves take, rounded up. */
  readonly minutes: number;
  /** The earliest Review due after now, or null. */
  readonly nextDue: Date | null;
}

/**
 * The session account's Today summary over every repertoire they train
 * (R-142): every due move, not a session's worth, and the new moves today's
 * allowance leaves (R-146). Cheap enough for the shell's badge on every
 * page: it computes no rows.
 */
async function loadTodaySummary(account: Account): Promise<TodaySummary> {
  const read = await allSnapshot(account);
  if (read === undefined)
    return { due: 0, toLearn: 0, minutes: 0, nextDue: null };
  const day = snapshotDay(read.snapshot);
  const counts = trainingCounts(day, read.now);
  return {
    ...counts,
    minutes: Math.ceil((counts.due * SECONDS_PER_REVIEW) / 60),
    nextDue: nextDue(day, read.now),
  };
}

/** todaySummary once per request: Today and the shell's badge share it. */
export const todaySummary = cache(loadTodaySummary);

/**
 * One repertoire on Today's list (R-221): its todayRows row (due count,
 * whether it can learn, its action and standing) with its entry's name,
 * side and kind.
 */
export interface TodayListRow extends TodayRow {
  readonly name: string;
  readonly side: Side;
  readonly kind: RepertoireKind;
}

/**
 * The snapshot entry of `repertoireId`. todayRows gives one row per entry
 * of the day built from these entries, so a miss is a programmer error.
 */
function entryOf(
  entries: ReadonlyMap<string, SnapshotEntry>,
  repertoireId: string,
): SnapshotEntry {
  const entry = entries.get(repertoireId);
  if (entry === undefined)
    throw new Error('a Today row names an entry of its snapshot');
  return entry;
}

/**
 * The session account's Today list: every repertoire they train, those
 * with due moves first, each named by its entry. Only Today reads it; the
 * per-repertoire work stays off the shell's badge.
 */
async function loadTodayList(account: Account): Promise<TodayListRow[]> {
  const read = await allSnapshot(account);
  if (read === undefined) return [];
  const { snapshot, now } = read;
  const entries = new Map(snapshot.entries.map((e) => [e.repertoire.id, e]));
  return todayRows(snapshotDay(snapshot), now).map((row) => {
    const { name, side, kind } = entryOf(entries, row.repertoireId);
    return { ...row, name, side, kind };
  });
}

/** todayList once per request. */
export const todayList = cache(loadTodayList);

/**
 * A repertoire page's training: its counts, what learning one chapter or
 * line of it would teach today (R-206), and whether today's limit stops
 * learning while moves are left (decision 11).
 */
export interface RepertoireTraining {
  readonly counts: TrainingCounts;
  readonly learn: LearnScope;
  readonly limitReached: boolean;
}

/**
 * The session account's training of one repertoire, for its page's train
 * buttons and Learn links; null when they do not train it.
 */
export async function repertoireTraining(
  account: Account,
  repertoireId: string,
): Promise<RepertoireTraining | null> {
  const read = await readSnapshot(account, {
    kind: 'repertoire',
    repertoireId,
  });
  const entry = read?.snapshot.entries[0];
  if (read === undefined || entry === undefined) return null;
  const day = snapshotDay(read.snapshot);
  return {
    counts: trainingCounts(day, read.now),
    learn: {
      tracked: trackedIn(entry.repertoire.graph, day.tracked),
      learnedToday: day.learnedToday,
      limits: day.limits,
    },
    limitReached:
      repertoireLearn(day, entry.repertoire.id).kind === 'limitReached',
  };
}
