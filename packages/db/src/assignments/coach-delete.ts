/**
 * R-49: when a coach deletes their account, every player with a live
 * assignment from them gets an automatic fork, in the deleting transaction
 * and before the cascade (plan decision 9). Internal to the package.
 */
import { canUseAssignment } from '@mychess/domain';
import type { Tx } from '../client';
import { autoForkAssignment } from './fork';
import { assignmentFacts } from './reach';

/**
 * Forks every live assignment of `coachId` for its player (R-137): the
 * coach's pairs read in one batch, then one fork per pair canUseAssignment
 * allows, made past the player's R-162 limits (R-163). The caller holds
 * the coach's account row and deletes it afterwards in the same
 * transaction; the forks carry the coach's display name, so they outlive
 * it.
 */
export async function forkForDeletingCoach(
  tx: Tx,
  coachId: string,
  now: Date,
): Promise<void> {
  const facts = await assignmentFacts(tx, { coachId });
  for (const { playerId, repertoireId } of facts.filter(
    (one) => canUseAssignment(one).ok,
  ))
    await autoForkAssignment(tx, { playerId, repertoireId }, now);
}
