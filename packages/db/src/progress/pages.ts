/**
 * The coach pages composed from one snapshot each (#303): the home's
 * players with when they last trained, and the group page (the group, who
 * could join it, and its grid). Like the progress reads in
 * coach-progress.ts, each takes the pool (`Db`), never a caller's
 * transaction, and the domain decides inside the snapshot (lastTrained,
 * groupGrid).
 */
import type { AccountRef } from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { coachPlayers, type LinkedAccount } from '../coaching';
import { coachGroup, type CoachGroup } from '../groups';
import { groupGrid, type GroupProgress } from './coach-progress';
import { coachProgressFacts, lastTrained } from './facts';

/** The coach's linked players not in `group`, by display name. */
async function addableTo(
  tx: Executor,
  coachId: string,
  group: CoachGroup,
): Promise<AccountRef[]> {
  const members = new Set(group.members.map((member) => member.id));
  return (await coachPlayers(tx, coachId))
    .filter((player) => !members.has(player.id))
    .map(({ id, displayName }) => ({ id, displayName }));
}

/** The group page: the group, who could join it, and its grid. */
export interface GroupPage {
  /** The coach's own group, its members by name. */
  readonly group: CoachGroup;
  /** The coach's linked players not yet in the group, by display name. */
  readonly addable: readonly AccountRef[];
  readonly grid: GroupProgress;
}

/**
 * The group page, its one read: the coach's own group with its members,
 * the coach's linked players not in it, and the grid (R-153): one column
 * per repertoire assigned to it (by name), one row per member (by name).
 * Undefined for any other group.
 */
export function coachGroupPage(
  db: Db,
  coachId: string,
  groupId: string,
  now: Date,
): Promise<GroupPage | undefined> {
  return db.transaction(async (tx) => {
    const group = await coachGroup(tx, coachId, groupId);
    if (group === undefined) return undefined;
    return {
      group,
      addable: await addableTo(tx, coachId, group),
      grid: await groupGrid(tx, coachId, group, now),
    };
  }, REPEATABLE_READ);
}

/** A player on the coach's home, with when they last trained (R-154). */
export interface HomePlayer extends LinkedAccount {
  /** The latest result on a repertoire the coach may see; null for none. */
  readonly lastTrained: Date | null;
}

/**
 * The coach's linked players by display name, each with when they last
 * trained as the coach may see it (R-154), from one snapshot: a fixed
 * number of statements whatever the number of players.
 */
export function coachHomePlayers(
  db: Db,
  coachId: string,
): Promise<HomePlayer[]> {
  return db.transaction(async (tx) => {
    const players = await coachPlayers(tx, coachId);
    const facts = await coachProgressFacts(
      tx,
      coachId,
      players.map((player) => player.id),
    );
    const last = await lastTrained(tx, coachId, facts);
    return players.map((player) => ({
      ...player,
      lastTrained: last.get(player.id) ?? null,
    }));
  }, REPEATABLE_READ);
}
