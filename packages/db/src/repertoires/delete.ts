/**
 * Deleting a repertoire, which may be assigned (R-131). Kept apart from
 * repository.ts: it unassigns through the assignments module, which reads
 * repertoires through repository.ts.
 */
import {
  ok,
  refuse,
  REPERTOIRE_REFUSALS,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import { lockAccountById } from '../accounts';
import { unassignAll } from '../assignments/assign';
import type { Executor } from '../client';
import { countSchema } from '../coach-queries';
import { isUuid } from '../ids';
import { repertoires } from '../schema';
import { repertoireScope } from './scope';

const NOT_FOUND = refuse(REPERTOIRE_REFUSALS.notFound);

/**
 * Deletes the owner's repertoire (its rows go by cascade); not found when
 * it is not theirs or `id` is no uuid. An assigned one is unassigned from
 * everyone first, in the same transaction, so each player's fork offer
 * keeps a snapshot of it (R-131, plan decision 5). Locks the owner's
 * account row first, the S4 lock order, so no assignment of it is made
 * meanwhile.
 */
export function deleteRepertoire(
  db: Executor,
  id: string,
  ownerId: string,
  now: Date,
): Promise<Result<undefined, RepertoireAccessRefusal>> {
  if (!isUuid(id)) return Promise.resolve(NOT_FOUND);
  return db.transaction(async (tx) => {
    const owned = repertoireScope(tx, { kind: 'own', ownerId }, 'edit', id);
    await lockAccountById(tx, ownerId);
    const found = countSchema.parse(await tx.$count(repertoires, owned));
    if (found === 0) return NOT_FOUND;
    await unassignAll(tx, { ownerId, repertoireId: id }, now);
    await tx.delete(repertoires).where(owned);
    return ok();
  });
}
