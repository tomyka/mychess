/**
 * The coach-progress access step for one repertoire (#392), shared by
 * coachRepertoireProgress and coachAssigneeStandings so a change to the
 * access rules (Q26, R-154 to R-156) is made once: the facts are read in
 * the caller's snapshot, the domain decides (progressRepertoire, granted
 * only: never a forked assignment, R-155), the link is read again in the
 * query, and each granted entry maps to what it loads through (entryRead).
 */
import { progressRepertoire } from '@mychess/domain';
import type { Executor } from '../client';
import { coachProgressFacts, linkedOf } from './facts';
import { entryRead, type EntryRead } from './view';

/** A player whose entry the domain grants, and how that entry is read. */
export interface GrantedRead {
  readonly playerId: string;
  readonly read: EntryRead;
  /**
   * The coach's repertoire a shared one is the player's Fork of, as the
   * domain names it (progressRepertoire, #328, R-155); null otherwise.
   */
  readonly forkOf: string | null;
}

/**
 * Each of `playerIds` whose entry of `repertoireId` progressRepertoire
 * grants and who is still linked when the link is read again, in the
 * caller's transaction. Statements: fixed in the number of players; none
 * for no players, the link read not at all when none is granted.
 */
export async function grantedReads(
  tx: Executor,
  coachId: string,
  repertoireId: string,
  playerIds: readonly string[],
): Promise<GrantedRead[]> {
  const facts = await coachProgressFacts(tx, coachId, playerIds);
  const granted = [...facts].flatMap(([playerId, one]) => {
    const entry = progressRepertoire(coachId, playerId, repertoireId, one);
    return entry?.kind === 'granted'
      ? [
          {
            playerId,
            read: entryRead(entry, { coachId, playerId }),
            forkOf: entry.source === 'shared' ? entry.forkOf : null,
          },
        ]
      : [];
  });
  if (granted.length === 0) return [];
  const linked = await linkedOf(
    tx,
    coachId,
    granted.map((one) => one.playerId),
  );
  return granted.filter((one) => linked.has(one.playerId));
}
