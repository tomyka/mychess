// What the owner's repertoire page shows of its assignments (R-15, R-131).
// Everything is read for the session account: an id from the path names
// only the repertoire, and every query filters by the coach again.
import {
  assignedPlayerCount,
  coachAssignments,
  coachGroups,
  coachPlayers,
  type CoachAssignment,
} from '@mychess/db';
import { isCoach } from '@mychess/domain';
import { getDb } from './db';
import { requireOnboarded } from './session';

export type { CoachAssignment, CoachAssignmentPlayer } from '@mychess/db';

/** A linked player the coach can assign to. */
export interface AssignablePlayer {
  readonly id: string;
  readonly displayName: string;
}

/** One of the coach's groups they can assign to. */
export interface AssignableGroup {
  readonly id: string;
  readonly name: string;
}

/** The assign panel: whom it can go to, and whom it went to. */
export interface AssignPanelData {
  readonly players: readonly AssignablePlayer[];
  readonly groups: readonly AssignableGroup[];
  readonly assignments: readonly CoachAssignment[];
}

export interface CoachAssignData {
  /** How many players have it live, for the delete dialog (R-131). */
  readonly assignedPlayers: number;
  /** The assign panel; null with Coach mode off. */
  readonly panel: AssignPanelData | null;
}

/** The session coach's assign panel for their repertoire `repertoireId`. */
async function panelOf(
  coachId: string,
  repertoireId: string,
): Promise<AssignPanelData> {
  const db = getDb();
  const players = await coachPlayers(db, coachId);
  const groups = await coachGroups(db, coachId);
  return {
    players: players.map(({ id, displayName }) => ({ id, displayName })),
    groups: groups.map(({ id, name }) => ({ id, name })),
    assignments: await coachAssignments(db, coachId, repertoireId, new Date()),
  };
}

/**
 * The assignments of the session account's own repertoire `repertoireId`,
 * already known to be theirs (repertoirePageData). The panel shows only in
 * Coach mode; the count is read either way, so a delete always says who
 * loses it.
 */
export async function coachAssignData(
  repertoireId: string,
): Promise<CoachAssignData> {
  const account = await requireOnboarded();
  return {
    assignedPlayers: await assignedPlayerCount(
      getDb(),
      account.id,
      repertoireId,
    ),
    panel: isCoach(account) ? await panelOf(account.id, repertoireId) : null,
  };
}
