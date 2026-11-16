/**
 * What a player trains (S6's seam, lead decision 9): their own repertoires
 * and those they have live by assignment, read through the `own` scope and
 * the shared player-live reads.
 */
import type { TrainingRepertoire } from '@mychess/chess';
import { isTrainingActive, ownScope } from '@mychess/domain';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { REPEATABLE_READ, type Executor } from '../client';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { repertoires } from '../schema';
import { loadLive, type LiveAssignment } from './player-live';

const ownRowsSchema = z.array(z.object({ id: z.uuid() }));

/** The player's own repertoires, oldest first, loaded through the `own` scope. */
async function ownLoaded(
  tx: Executor,
  playerId: string,
): Promise<LoadedRepertoire[]> {
  const owned = ownRowsSchema.parse(
    await tx
      .select({ id: repertoires.id })
      .from(repertoires)
      .where(repertoireScope(tx, ownScope(playerId), 'view'))
      .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
  );
  const out: LoadedRepertoire[] = [];
  for (const { id } of owned) {
    const loaded = await loadRepertoireRows(
      tx,
      repertoireScope(tx, ownScope(playerId), 'view', id),
    );
    if (loaded !== undefined) out.push(loaded);
  }
  return out;
}

/**
 * What `playerId` trains, loaded (S6's seam, lead decision 9): their own
 * repertoires oldest first, and those they have live by assignment
 * (usableAssignments: a forked one is absent, R-128). Exported for
 * training/entries.ts only, not from the package index; run it inside the
 * caller's REPEATABLE_READ transaction.
 */
export async function trainingSources(
  tx: Executor,
  playerId: string,
): Promise<{
  readonly own: LoadedRepertoire[];
  readonly assigned: LiveAssignment[];
}> {
  return {
    own: await ownLoaded(tx, playerId),
    assigned: await loadLive(tx, playerId),
  };
}

/**
 * Every repertoire `playerId` trains (S6's seam, lead decision 9): their
 * own, then those they have live by assignment, a paused one inactive
 * (R-46). A forked one is absent; the fork is one of their own (R-128).
 */
export function trainingRepertoires(
  db: Executor,
  playerId: string,
): Promise<TrainingRepertoire[]> {
  return db.transaction(async (tx) => {
    const { own, assigned } = await trainingSources(tx, playerId);
    return [
      ...own.map(({ repertoire, graph }) => ({
        id: repertoire.id,
        graph,
        active: true,
      })),
      ...assigned.map(({ assignment, loaded }) => ({
        id: assignment.repertoireId,
        graph: loaded.graph,
        active: isTrainingActive(assignment.pausedAt),
      })),
    ];
  }, REPEATABLE_READ);
}
