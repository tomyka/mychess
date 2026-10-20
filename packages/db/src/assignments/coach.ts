/**
 * What a coach reads of their own assignments of one repertoire (R-46,
 * R-51, R-128, R-131). The domain decides access (canViewRepertoire: the
 * coach's own repertoire) and the badges (assignmentStatus); every
 * statement filters again on `assignments.coach_id` and the repertoire's
 * owner, and lists a player only while they are linked to the coach.
 */
import { allLearned } from '@mychess/chess';
import {
  assignmentStatus,
  canViewRepertoire,
  effectiveDeadline,
  isTrainingActive,
} from '@mychess/domain';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assignmentPlayers, assignments } from '../assignment-schema';
import { playerRowsSchema } from '../coach-queries';
import type { Executor } from '../client';
import { isUuid } from '../ids';
import { loadRepertoireRows, ownedBy } from '../repertoires/repository';
import {
  accounts,
  coachLinks,
  groupMembers,
  groups,
  repertoires,
} from '../schema';
import { effectiveAssignments } from './effective';
import { NOTHING_LEARNED } from './player';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;

/** One player an assignment reaches, as the coach sees them. */
export interface CoachAssignmentPlayer {
  readonly playerId: string;
  readonly displayName: string;
  /** effectiveDeadline across every row reaching the player (R-16, R-134). */
  readonly deadline: string | null;
  /** The badges, from assignmentStatus at `now` (R-51, R-128, R-132). */
  readonly paused: boolean;
  readonly forked: boolean;
  readonly done: boolean;
  readonly overdue: boolean;
}

/** One assignment row of the coach's repertoire. */
export interface CoachAssignment {
  readonly id: string;
  readonly target: {
    readonly kind: 'player' | 'group';
    readonly id: string;
    readonly name: string;
  };
  /** The row's own deadline, `YYYY-MM-DD` or null. */
  readonly deadline: string | null;
  /** The linked players it reaches, by name. */
  readonly players: readonly CoachAssignmentPlayer[];
}

/** The coach's assignments of their own repertoire, as SQL. */
const ofCoach = (coachId: string, repertoireId: string) =>
  and(
    eq(assignments.coachId, coachId),
    eq(assignments.repertoireId, repertoireId),
    eq(repertoires.ownerAccountId, coachId),
  );

const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    playerId: z.string().min(1).nullable(),
    groupId: z.uuid().nullable(),
    deadline: z.iso.date().nullable(),
    playerName: z.string().nullable(),
    groupName: z.string().nullable(),
  }),
);
type Row = z.infer<typeof rowsSchema>[number];

/** The rows, oldest first, with their target's name. */
async function rowsOf(
  db: Executor,
  coachId: string,
  repertoireId: string,
): Promise<Row[]> {
  return rowsSchema.parse(
    await db
      .select({
        id: assignments.id,
        playerId: assignments.playerId,
        groupId: assignments.groupId,
        deadline: assignments.deadline,
        playerName: accounts.displayName,
        groupName: groups.name,
      })
      .from(assignments)
      .innerJoin(repertoires, eq(repertoires.id, assignments.repertoireId))
      .leftJoin(accounts, eq(accounts.id, assignments.playerId))
      .leftJoin(groups, eq(groups.id, assignments.groupId))
      .where(ofCoach(coachId, repertoireId))
      .orderBy(asc(assignments.createdAt), asc(assignments.id)),
  );
}

const reachRowsSchema = z.array(
  z.object({
    assignmentId: z.uuid(),
    playerId: z.string().min(1),
    displayName: z.string(),
  }),
);
type Reach = z.infer<typeof reachRowsSchema>[number];

/** A player row's player, or one member of a group row. */
const reachedPlayer = sql`coalesce(${groupMembers.playerId}, ${assignments.playerId})`;

/** Each linked player each row reaches: its own player, or its group's members. */
async function reachOf(
  db: Executor,
  coachId: string,
  repertoireId: string,
): Promise<Reach[]> {
  return reachRowsSchema.parse(
    await db
      .select({
        assignmentId: assignments.id,
        playerId: coachLinks.playerId,
        displayName: accounts.displayName,
      })
      .from(assignments)
      .innerJoin(repertoires, eq(repertoires.id, assignments.repertoireId))
      .leftJoin(groupMembers, eq(groupMembers.groupId, assignments.groupId))
      .innerJoin(
        coachLinks,
        and(
          eq(coachLinks.coachId, assignments.coachId),
          eq(coachLinks.playerId, reachedPlayer),
        ),
      )
      .innerJoin(accounts, eq(accounts.id, coachLinks.playerId))
      .where(ofCoach(coachId, repertoireId)),
  );
}

/** One player's state on the repertoire, decided by the domain. */
async function playerState(
  db: Executor,
  reach: Reach,
  { repertoireId, done, now }: StateFacts,
): Promise<CoachAssignmentPlayer> {
  const held = await effectiveAssignments(db, reach.playerId, {
    withForked: true,
  });
  const assignment = held.find((a) => a.repertoireId === repertoireId);
  const deadline =
    assignment === undefined ? null : effectiveDeadline(assignment.sources);
  const status = assignmentStatus(
    {
      deadline,
      done,
      paused: !isTrainingActive(assignment?.pausedAt ?? null),
      forked: (assignment?.forkedAt ?? null) !== null,
    },
    now,
  );
  return {
    playerId: reach.playerId,
    displayName: reach.displayName,
    deadline,
    ...status,
  };
}

interface StateFacts {
  readonly repertoireId: string;
  readonly done: boolean;
  readonly now: Date;
}

/** Each reached player's state, by player id, read once per player. */
async function statesOf(
  db: Executor,
  reach: readonly Reach[],
  facts: StateFacts,
): Promise<Map<string, CoachAssignmentPlayer>> {
  const states = new Map<string, CoachAssignmentPlayer>();
  for (const one of reach)
    if (!states.has(one.playerId))
      states.set(one.playerId, await playerState(db, one, facts));
  return states;
}

function targetOf(row: Row): CoachAssignment['target'] {
  return row.groupId === null
    ? { kind: 'player', id: row.playerId ?? '', name: row.playerName ?? '' }
    : { kind: 'group', id: row.groupId, name: row.groupName ?? '' };
}

const byName = (a: CoachAssignmentPlayer, b: CoachAssignmentPlayer): number =>
  a.displayName.localeCompare(b.displayName, 'lt');

/**
 * The coach's assignments of their own repertoire `repertoireId`, oldest
 * first, each with the linked players it reaches and their badges at
 * `now`; empty for a repertoire that is not theirs.
 */
export function coachAssignments(
  db: Executor,
  coachId: string,
  repertoireId: string,
  now: Date,
): Promise<CoachAssignment[]> {
  if (!isUuid(repertoireId)) return Promise.resolve([]);
  return db.transaction(async (tx) => {
    const loaded = await loadRepertoireRows(tx, ownedBy(repertoireId, coachId));
    if (
      loaded === undefined ||
      !canViewRepertoire({ id: coachId }, loaded.repertoire).ok
    )
      return [];
    const reach = await reachOf(tx, coachId, repertoireId);
    const done = allLearned(loaded.graph, NOTHING_LEARNED);
    const states = await statesOf(tx, reach, { repertoireId, done, now });
    return (await rowsOf(tx, coachId, repertoireId)).map((row) => ({
      id: row.id,
      target: targetOf(row),
      deadline: row.deadline,
      players: reach
        .filter((one) => one.assignmentId === row.id)
        .flatMap((one) => states.get(one.playerId) ?? [])
        .toSorted(byName),
    }));
  }, SNAPSHOT);
}

/** The players who forked the repertoire (R-128). */
async function forkedPlayers(
  db: Executor,
  repertoireId: string,
): Promise<Set<string>> {
  const rows = playerRowsSchema.parse(
    await db
      .select({ playerId: assignmentPlayers.playerId })
      .from(assignmentPlayers)
      .where(
        and(
          eq(assignmentPlayers.repertoireId, repertoireId),
          isNotNull(assignmentPlayers.forkedAt),
        ),
      ),
  );
  return new Set(rows.map((row) => row.playerId));
}

/**
 * How many distinct linked players have the coach's repertoire live (any
 * row reaches them and they have not forked it), for the delete dialog:
 * the players who get a fork offer when it is deleted (R-131). 0 for a
 * repertoire not theirs.
 */
export async function assignedPlayerCount(
  db: Executor,
  coachId: string,
  repertoireId: string,
): Promise<number> {
  if (!isUuid(repertoireId)) return 0;
  return db.transaction(async (tx) => {
    const reach = await reachOf(tx, coachId, repertoireId);
    const forked = await forkedPlayers(tx, repertoireId);
    return new Set(
      reach.map((one) => one.playerId).filter((id) => !forked.has(id)),
    ).size;
  }, SNAPSHOT);
}
