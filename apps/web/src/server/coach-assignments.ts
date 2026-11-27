import 'server-only';
// What the owner's repertoire page shows of its assignments (R-15, R-131).
// Everything is read for the session account: an id from the path names
// only the repertoire, and every query filters by the coach again.
import {
  coachGroups,
  coachPlayers,
  repertoireAssignees,
  type AssigneeStanding,
  type CoachAssignment,
  type RepertoireAssignees,
} from '@mychess/db';
import {
  assignableTargets,
  isCoach,
  vilniusDay,
  type AccountRef,
  type AssignablePlayer,
} from '@mychess/domain';
import { getDb } from './db';
import { requireOnboarded } from './session';

/** One of the coach's groups they can assign to. */
interface AssignableGroup {
  readonly id: string;
  readonly name: string;
}

/**
 * The assign panel: whom it can still go to (assignableTargets: those it
 * is not yet assigned to, each player with the groups they have it
 * through, R-134), and whom it went to.
 */
export interface AssignPanelData {
  readonly players: readonly AssignablePlayer<AccountRef>[];
  readonly groups: readonly AssignableGroup[];
  readonly assignments: readonly CoachAssignment[];
  /**
   * Today in Vilnius, `YYYY-MM-DD`: the date fields' earliest day, a hint
   * only; the domain refuses an earlier one (R-203, R-210). Read here, not
   * in the browser, so the server and the browser render the same.
   */
  readonly today: string;
  /**
   * Each assigned player's standing on it and their assignment's status
   * (R-225, R-231: the Done pill), by player id; null where the coach is
   * shown none, as for a player's own copy (R-155).
   */
  readonly standings: ReadonlyMap<string, AssigneeStanding | null>;
}

export interface CoachAssignData {
  /** How many players have it live, for the delete dialog (R-131). */
  readonly assignedPlayers: number;
  /** The assign panel; null with Coach mode off. */
  readonly panel: AssignPanelData | null;
}

/** The session coach's assign panel, from who has their repertoire. */
async function panelOf(
  coachId: string,
  { assignments, standings }: RepertoireAssignees,
  now: Date,
): Promise<AssignPanelData> {
  const db = getDb();
  const players = await coachPlayers(db, coachId);
  const groups = await coachGroups(db, coachId);
  const offer = assignableTargets(
    players.map(({ id, displayName }) => ({ id, displayName })),
    groups.map(({ id, name }) => ({ id, name })),
    assignments.map(({ target, players: reached }) => ({
      target,
      players: reached.map(({ playerId, status }) => ({
        playerId,
        forked: status.forked,
      })),
    })),
  );
  return { ...offer, assignments, today: vilniusDay(now), standings };
}

/**
 * The assignments of the session account's own repertoire `repertoireId`,
 * already known to be theirs (repertoirePageData), in one snapshot
 * (repertoireAssignees, #395). The panel shows only in Coach mode; the
 * count is read either way, so a delete always says who loses it.
 */
export async function coachAssignData(
  repertoireId: string,
): Promise<CoachAssignData> {
  const account = await requireOnboarded();
  const now = new Date();
  const assignees = await repertoireAssignees(
    getDb(),
    { coachId: account.id, repertoireId },
    now,
  );
  return {
    assignedPlayers: assignees.livePlayers,
    panel: isCoach(account) ? await panelOf(account.id, assignees, now) : null,
  };
}
