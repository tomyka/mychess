/**
 * The repertoires a player trains, with what the learn order needs (R-145;
 * S6 decision 7): their own and those they have live by assignment, read
 * through the same access rules as trainingRepertoires (trainingSources).
 */
import type { Side, TrainingRepertoire } from '@mychess/chess';
import {
  assignmentDeadline,
  isTrainingActive,
  learnOrder,
  type TrainingEntry,
} from '@mychess/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import { REPEATABLE_READ, type Executor } from '../client';
import { namesOf } from '../assignments/names';
import { trainingSources } from '../assignments/player-training';

const assignedRowsSchema = z.array(z.object({ repertoireId: z.uuid() }));

/**
 * The repertoires `accountId` assigned, as a coach, to at least one player
 * or group (R-230), in one statement. Unassigning deletes the row, so one
 * unassigned from everyone is not here.
 */
export async function assignedByMe(
  db: Executor,
  accountId: string,
): Promise<Set<string>> {
  const rows = assignedRowsSchema.parse(
    await db
      .selectDistinct({ repertoireId: assignments.repertoireId })
      .from(assignments)
      .where(eq(assignments.coachId, accountId)),
  );
  return new Set(rows.map((row) => row.repertoireId));
}

/**
 * The coach's name, read in the same snapshot as the repertoire: an
 * account row cannot go while a repertoire it owns is held, so a missing
 * one is a programmer error.
 */
function coachOf(names: ReadonlyMap<string, string>, ownerId: string): string {
  const name = names.get(ownerId);
  if (name === undefined) throw new Error('trainingEntries: no coach account');
  return name;
}

/** One repertoire the player trains, as home and the training page list it. */
export interface TrainingRepertoireEntry extends TrainingEntry {
  readonly repertoire: TrainingRepertoire;
  readonly name: string;
  readonly side: Side;
  /**
   * An assigned repertoire's coach, its owner's display name (#338), so a
   * drill names the coach of a move's comment (R-102); null for one's own.
   */
  readonly coachName: string | null;
}

/**
 * trainingRepertoires with names, kind and deadline, in learnOrder (R-145):
 * deadline assignments earliest first, other assignments, own repertoires.
 * An assignment's deadline is assignmentDeadline, as in S5.
 */
export function trainingEntries(
  db: Executor,
  playerId: string,
): Promise<TrainingRepertoireEntry[]> {
  return db.transaction(async (tx) => {
    const { own, assigned } = await trainingSources(tx, playerId);
    const coaches = await namesOf(
      tx,
      assigned.map(({ loaded }) => loaded.repertoire.ownerId),
    );
    const ownEntries = own.map(
      ({ repertoire, graph }, position): TrainingRepertoireEntry => ({
        kind: 'own',
        deadline: null,
        position,
        repertoire: { id: repertoire.id, graph, active: true },
        name: repertoire.name,
        side: repertoire.side,
        coachName: null,
      }),
    );
    const assignedEntries = assigned.map(
      ({ assignment, loaded }, index): TrainingRepertoireEntry => ({
        kind: 'assigned',
        deadline: assignmentDeadline(assignment),
        position: own.length + index,
        repertoire: {
          id: assignment.repertoireId,
          graph: loaded.graph,
          active: isTrainingActive(assignment.pausedAt),
        },
        name: loaded.repertoire.name,
        side: loaded.repertoire.side,
        coachName: coachOf(coaches, loaded.repertoire.ownerId),
      }),
    );
    return learnOrder([...ownEntries, ...assignedEntries]);
  }, REPEATABLE_READ);
}
