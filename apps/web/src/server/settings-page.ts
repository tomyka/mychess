import 'server-only';
// Settings' My coaches (R-237): each coach the player is linked to, with
// the repertoires that coach assigns them (directly or through a group)
// and the player's groups of that coach. Read from the player's own
// assignments only: nothing here reads another player.
import {
  playerAssignments,
  playerCoaches,
  type CoachStatus,
  type GroupRef,
  type LinkedAccount,
  type PlayerAssignment,
} from '@mychess/db';
import { vilniusDay, type AccountRef } from '@mychess/domain';
import { getDb } from './db';

/** One repertoire a coach assigns the player, with its status (part 5 wording). */
interface MyCoachAssignment {
  readonly repertoireId: string;
  readonly name: string;
  readonly status: CoachStatus;
}

/** A coach the player is linked to: the groups and what the coach assigns. */
export interface MyCoach extends AccountRef {
  readonly groups: readonly GroupRef[];
  readonly assignments: readonly MyCoachAssignment[];
}

/** My coaches as Settings shows it; `today` is the Vilnius day, for deadlines. */
export interface MyCoachesData {
  readonly coaches: readonly MyCoach[];
  readonly today: string;
}

/**
 * An assignment's status in the shape the shared status line takes, from
 * the player's own facts: a live assignment is never forked (a fork is an
 * own repertoire).
 */
const statusOf = (assignment: PlayerAssignment): CoachStatus => ({
  deadline: assignment.deadline,
  overdue: assignment.badges.overdue,
  paused: assignment.paused,
  done: assignment.done,
  forked: false,
});

const byName = (a: MyCoachAssignment, b: MyCoachAssignment): number =>
  a.name.localeCompare(b.name);

/**
 * One row per coach, in the coaches' order, with that coach's assignments
 * (matched on coachId) by repertoire name. An assignment of a coach no
 * longer among `coaches` is dropped.
 */
export function coachRows(
  coaches: readonly LinkedAccount[],
  assignments: readonly PlayerAssignment[],
): MyCoach[] {
  return coaches.map(({ id, displayName, groups }) => ({
    id,
    displayName,
    groups,
    assignments: assignments
      .filter(({ coachId }) => coachId === id)
      .map((assignment) => ({
        repertoireId: assignment.repertoireId,
        name: assignment.name,
        status: statusOf(assignment),
      }))
      .sort(byName),
  }));
}

/** The session player's My coaches at `now`. */
export async function myCoachesData(
  playerId: string,
  now: Date,
): Promise<MyCoachesData> {
  const [coaches, assignments] = await Promise.all([
    playerCoaches(getDb(), playerId),
    playerAssignments(getDb(), playerId, now),
  ]);
  return { coaches: coachRows(coaches, assignments), today: vilniusDay(now) };
}
