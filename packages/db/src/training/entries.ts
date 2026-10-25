/**
 * The repertoires a player trains, with what the learn order needs (R-145;
 * S6 decision 7): their own and those they have live by assignment, read
 * through the same access rules as trainingRepertoires (trainingSources).
 */
import type { Side, TrainingRepertoire } from '@mychess/chess';
import {
  assignmentStatusOf,
  isTrainingActive,
  learnOrder,
  type TrainingEntry,
} from '@mychess/domain';
import type { Executor } from '../client';
import { trainingSources } from '../assignments/player';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;

/** One repertoire the player trains, as home and the training page list it. */
export interface TrainingRepertoireEntry extends TrainingEntry {
  readonly repertoire: TrainingRepertoire;
  readonly name: string;
  readonly side: Side;
}

/**
 * trainingRepertoires with names, kind and deadline, in learnOrder (R-145):
 * deadline assignments earliest first, other assignments, own repertoires.
 * An assignment's deadline is its effective deadline at `now`, as in S5.
 */
export function trainingEntries(
  db: Executor,
  playerId: string,
  now: Date,
): Promise<TrainingRepertoireEntry[]> {
  return db.transaction(async (tx) => {
    const { own, assigned } = await trainingSources(tx, playerId);
    const ownEntries = own.map(
      ({ repertoire, graph }, position): TrainingRepertoireEntry => ({
        kind: 'own',
        deadline: null,
        position,
        repertoire: { id: repertoire.id, graph, active: true },
        name: repertoire.name,
        side: repertoire.side,
      }),
    );
    const assignedEntries = assigned.map(
      ({ assignment, loaded }, index): TrainingRepertoireEntry => ({
        kind: 'assigned',
        deadline: assignmentStatusOf(assignment, { done: false, now }).deadline,
        position: own.length + index,
        repertoire: {
          id: assignment.repertoireId,
          graph: loaded.graph,
          active: isTrainingActive(assignment.pausedAt),
        },
        name: loaded.repertoire.name,
        side: loaded.repertoire.side,
      }),
    );
    return learnOrder([...ownEntries, ...assignedEntries]);
  }, SNAPSHOT);
}
