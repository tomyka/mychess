/**
 * An assigned repertoire as its player opens it, with the coach's name and
 * the player's own notes (R-21, R-102), read through the shared player-live
 * reads in one repeatable-read snapshot.
 */
import { assignedScope } from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { REPEATABLE_READ, type Executor } from '../client';
import { isUuid } from '../ids';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { personalNotes } from '../schema';
import { namesOf } from './names';
import {
  inLive,
  trackedOf,
  statusOf,
  usableAssignment,
  type LiveAssignment,
} from './player-live';

/** An assigned repertoire as its player opens it (R-21, R-102). */
export interface AssignedRepertoire extends LoadedRepertoire {
  readonly coachName: string;
  /** The player's own notes on it, by move key. */
  readonly personalNotes: Readonly<Record<string, string>>;
  readonly paused: boolean;
  /** effectiveDeadline: `YYYY-MM-DD` or null (R-16, R-134). */
  readonly deadline: string | null;
  /** assignmentStatus at `now` (R-51). */
  readonly overdue: boolean;
}

const noteRowsSchema = z.array(
  z.object({ moveKey: z.string().min(1), text: z.string() }),
);

async function notesOf(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<Record<string, string>> {
  const rows = noteRowsSchema.parse(
    await db
      .select({ moveKey: personalNotes.moveKey, text: personalNotes.text })
      .from(personalNotes)
      .where(
        and(
          eq(personalNotes.playerAccountId, playerId),
          inLive(db, personalNotes.repertoireId, { playerId, repertoireId }),
        ),
      ),
  );
  return Object.fromEntries(rows.map((row) => [row.moveKey, row.text]));
}

/** The player's live assignment of the repertoire with the repertoire, or undefined. */
async function openLive(
  tx: Executor,
  playerId: string,
  repertoireId: string,
): Promise<LiveAssignment | undefined> {
  const assignment = await usableAssignment(tx, playerId, repertoireId);
  if (assignment === undefined) return undefined;
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, assignedScope(playerId), 'view', repertoireId),
  );
  return loaded === undefined ? undefined : { assignment, loaded };
}

/**
 * Repertoire `repertoireId` as `playerId` has it by assignment, with the
 * coach's comments (R-102), the coach's name, the player's own notes and
 * its deadline and overdue as of `now`; undefined unless it is assigned to
 * them now and not forked.
 */
export function assignedRepertoireForPlayer(
  db: Executor,
  playerId: string,
  repertoireId: string,
  now: Date,
): Promise<AssignedRepertoire | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const opened = await openLive(tx, playerId, repertoireId);
    if (opened === undefined) return undefined;
    const { loaded } = opened;
    const names = await namesOf(tx, [loaded.repertoire.ownerId]);
    const { paused, deadline, overdue } = statusOf(
      opened,
      await trackedOf(tx, playerId, [loaded.graph]),
      now,
    );
    return {
      ...loaded,
      coachName: names.get(loaded.repertoire.ownerId) ?? '',
      personalNotes: await notesOf(tx, playerId, repertoireId),
      paused,
      deadline,
      overdue,
    };
  }, REPEATABLE_READ);
}
