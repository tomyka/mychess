import 'server-only';
// What the owner's repertoire page shows of its assignments (R-15, R-131).
// Everything is read for the session account: an id from the path names
// only the repertoire, and every query filters by the coach again.
import {
  assignedPlayerCount,
  coachAssigneeStandings,
  coachAssignments,
  coachGroups,
  coachPlayers,
  type CoachAssignment,
  type Db,
} from '@mychess/db';
import type { Standing } from '@mychess/chess';
import {
  assignableTargets,
  isCoach,
  vilniusDay,
  type AccountRef,
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
 * is not yet assigned to), and whom it went to.
 */
export interface AssignPanelData {
  readonly players: readonly AccountRef[];
  readonly groups: readonly AssignableGroup[];
  readonly assignments: readonly CoachAssignment[];
  /**
   * Today in Vilnius, `YYYY-MM-DD`: the date fields' earliest day, a hint
   * only; the domain refuses an earlier one (R-203, R-210). Read here, not
   * in the browser, so the server and the browser render the same.
   */
  readonly today: string;
  /**
   * Each assigned player's standing on it (R-225), by player id; null
   * where the coach is shown none, as for a player's own copy (R-155).
   */
  readonly standings: ReadonlyMap<string, Standing | null>;
}

/**
 * The standing of each player `assignments` reach, in one snapshot with
 * the coach progress page's access rules (Q26, R-155, R-156; #385):
 * whatever that page withholds is null here.
 */
function assigneeStandings(
  db: Db,
  of: { readonly coachId: string; readonly repertoireId: string },
  assignments: readonly CoachAssignment[],
  now: Date,
): Promise<ReadonlyMap<string, Standing | null>> {
  const playerIds = [
    ...new Set(assignments.flatMap((a) => a.players.map((p) => p.playerId))),
  ];
  return coachAssigneeStandings(db, { ...of, playerIds }, now);
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
  const now = new Date();
  const players = await coachPlayers(db, coachId);
  const groups = await coachGroups(db, coachId);
  const assignments = await coachAssignments(db, coachId, repertoireId, now);
  const offer = assignableTargets(
    players.map(({ id, displayName }) => ({ id, displayName })),
    groups.map(({ id, name }) => ({ id, name })),
    assignments.map((assignment) => assignment.target),
  );
  const standings = await assigneeStandings(
    db,
    { coachId, repertoireId },
    assignments,
    now,
  );
  return { ...offer, assignments, today: vilniusDay(now), standings };
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
