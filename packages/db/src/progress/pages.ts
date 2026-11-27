/**
 * The group page composed from one snapshot (#303): the group, who could
 * join it, its grid and its open invite. Like the progress reads in
 * coach-progress.ts and the dashboard (dashboard.ts), it takes the pool
 * (`Db`), never a caller's transaction, and the domain decides inside the
 * snapshot (groupGrid).
 */
import type { AccountRef } from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { coachPlayers } from '../coaching';
import {
  assignmentsToGroup,
  coachGroup,
  type CoachGroup,
  type GroupAssignment,
} from '../groups';
import { openGroupInvite, type OpenGroupInvite } from '../invites';
import { groupGrid, type GroupProgress } from './coach-progress';

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
  /** The group's newest open invite (R-232); null for none. */
  readonly invite: OpenGroupInvite | null;
  /** This coach's assignments to the group, by repertoire name (R-232). */
  readonly assignments: readonly GroupAssignment[];
}

/**
 * The group page, its one read: the coach's own group with its members,
 * the coach's linked players not in it, the grid (R-153): one column
 * per repertoire assigned to it (by name), one row per member (by name),
 * its open invite and its assignments with their deadlines (R-232).
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
      invite: (await openGroupInvite(tx, coachId, groupId, now)) ?? null,
      assignments: await assignmentsToGroup(tx, coachId, groupId),
    };
  }, REPEATABLE_READ);
}
