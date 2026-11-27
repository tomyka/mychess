/**
 * What a coach reads of their own assignments (R-46, R-51, R-128, R-131,
 * R-225, R-230; #395). The domain decides access (canViewRepertoire: the
 * coach's own repertoire), the deadline (assignmentDeadline), the status
 * (assignmentStatusOf, through coachStatus), the standing where granted
 * (grantedReads, Q26, R-155) and both counts (assigneeCount,
 * livePlayerCount); every statement filters again on
 * `assignments.coach_id`, and the rows on the repertoire's owner, which
 * assignments_repertoire_fk already guarantees is the coach. A player is
 * listed only while they are linked to the coach (the link check in
 * reach.ts). A fixed number of statements, whatever the number of players.
 */
import { playerKeys, type TrackedReview } from '@mychess/chess';
import {
  assigneeCount,
  assignmentDeadline,
  byName,
  canViewRepertoire,
  livePlayerCount,
  ownScope,
  type AssignmentFacts,
} from '@mychess/domain';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { isUuid } from '../ids';
import {
  assigneeStandings,
  type AssigneeStanding,
  type ReachedAssignee,
} from '../progress/assignee-standings';
import type { LoadedGraph } from '../progress/view';
import { loadRepertoireRows } from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { accounts, groups, repertoires } from '../schema';
import { trackedReviews } from '../training/reviews';
import { namesOf } from './names';
import { assignmentFacts, reachedPairs } from './reach';
import { coachStatus, type CoachStatus } from './status';

/** One player an assignment reaches, as the coach sees them. */
export interface CoachAssignmentPlayer {
  readonly playerId: string;
  readonly displayName: string;
  /** effectiveDeadline across every row reaching the player (R-16, R-134). */
  readonly deadline: string | null;
  /**
   * Their status at `now` as the domain decides it (coachStatus,
   * assignmentStatusOf): the deadline, overdue, paused, done (R-129), or
   * forked alone (R-46, R-51, R-128, R-132).
   */
  readonly status: CoachStatus;
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

/** Who has the coach's repertoire, as its Repertoire screen shows it. */
export interface RepertoireAssignees {
  /** Its assignment rows, oldest first, each with the players it reaches. */
  readonly assignments: readonly CoachAssignment[];
  /**
   * Each reached player's standing and status, by player id; null where
   * the coach progress page shows none (unlinked, forked: Q26, R-155).
   */
  readonly standings: ReadonlyMap<string, AssigneeStanding | null>;
  /** How many players have it live, for the delete dialog (R-131). */
  readonly livePlayers: number;
  /** How many players it reaches, those who forked it included (R-225). */
  readonly assignees: number;
}

/** Which repertoire, asked by which coach. */
export interface AssigneesRequest {
  /** The acting coach: the session's, never one a client names. */
  readonly coachId: string;
  readonly repertoireId: string;
}

const NO_ASSIGNEES: RepertoireAssignees = {
  assignments: [],
  standings: new Map(),
  livePlayers: 0,
  assignees: 0,
};

/** The coach's assignments of their own repertoire, as SQL. */
const ofCoach = (db: Executor, coachId: string, repertoireId: string) =>
  and(
    eq(assignments.coachId, coachId),
    eq(assignments.repertoireId, repertoireId),
    repertoireScope(db, ownScope(coachId), 'view'),
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
      .where(ofCoach(db, coachId, repertoireId))
      .orderBy(asc(assignments.createdAt), asc(assignments.id)),
  );
}

/** A reached player as the coach sees them, with what they were read from. */
interface Listed extends ReachedAssignee {
  readonly facts: AssignmentFacts;
  readonly player: CoachAssignmentPlayer;
}

const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/**
 * Each reached player's name, deadline, status at `now` (coachStatus: done
 * when every player move of the graph is tracked, R-129) and Reviews. One
 * read of the names and one of the Reviews of every player, of the
 * repertoire's player moves only.
 */
async function listedOf(
  db: Executor,
  facts: readonly AssignmentFacts[],
  { graph }: LoadedGraph,
  now: Date,
): Promise<Listed[]> {
  const playerIds = facts.map((one) => one.playerId);
  const names = await namesOf(db, playerIds);
  const tracked = await trackedReviews(db, playerIds, playerKeys(graph));
  return facts.map((one) => {
    // The reached player's account cascades away with their link.
    const displayName = names.get(one.playerId);
    if (displayName === undefined)
      throw new Error('repertoireAssignees: the player is gone');
    const reviews = tracked.get(one.playerId) ?? NO_REVIEWS;
    const status = coachStatus(one, graph, reviews, now);
    return {
      playerId: one.playerId,
      status,
      tracked: reviews,
      facts: one,
      player: {
        playerId: one.playerId,
        displayName,
        deadline: assignmentDeadline(one),
        status,
      },
    };
  });
}

/** The listed players that row `assignmentId` reaches, by name. */
const reachedBy = (
  listed: readonly Listed[],
  assignmentId: string,
): CoachAssignmentPlayer[] =>
  listed
    .filter(({ facts }) =>
      facts.reaches.some((reach) => reach.assignmentId === assignmentId),
    )
    .map(({ player }) => player)
    .toSorted(byPlayerName);

function targetOf(row: Row): CoachAssignment['target'] {
  return row.groupId === null
    ? { kind: 'player', id: row.playerId ?? '', name: row.playerName ?? '' }
    : { kind: 'group', id: row.groupId, name: row.groupName ?? '' };
}

/** Players by name in English order, then id. */
const byPlayerName = byName((one: CoachAssignmentPlayer) => ({
  name: one.displayName,
  id: one.playerId,
}));

/** The repertoire through the coach's own scope, if the domain lets them view it. */
async function ownLoaded(
  tx: Executor,
  coachId: string,
  repertoireId: string,
): Promise<LoadedGraph | undefined> {
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, ownScope(coachId), 'view', repertoireId),
  );
  if (
    loaded === undefined ||
    !canViewRepertoire({ id: coachId }, loaded.repertoire).ok
  )
    return undefined;
  const { name, side } = loaded.repertoire;
  return { repertoire: { id: repertoireId, name, side }, graph: loaded.graph };
}

/**
 * Who has the coach's own repertoire `repertoireId` (#395): its rows,
 * oldest first, each with the linked players it reaches and their status
 * at `now`; each reached player's standing where granted; and both
 * counts. One repeatable-read snapshot, a fixed number of statements;
 * nothing for a repertoire not theirs, none for a malformed id.
 */
export function repertoireAssignees(
  db: Db,
  { coachId, repertoireId }: AssigneesRequest,
  now: Date,
): Promise<RepertoireAssignees> {
  if (!isUuid(repertoireId)) return Promise.resolve(NO_ASSIGNEES);
  return db.transaction(async (tx) => {
    const loaded = await ownLoaded(tx, coachId, repertoireId);
    if (loaded === undefined) return NO_ASSIGNEES;
    const rows = await rowsOf(tx, coachId, repertoireId);
    const facts = await assignmentFacts(tx, { coachId, repertoireId });
    const listed = await listedOf(tx, facts, loaded, now);
    return {
      assignments: rows.map((row) => ({
        id: row.id,
        target: targetOf(row),
        deadline: row.deadline,
        players: reachedBy(listed, row.id),
      })),
      standings: await assigneeStandings(
        tx,
        { coachId, loaded, reached: listed },
        now,
      ),
      livePlayers: livePlayerCount(facts),
      assignees: assigneeCount(facts),
    };
  }, REPEATABLE_READ);
}

/**
 * How many players each of the coach's repertoires reaches, those who
 * forked it included (assigneeCount, R-225, R-230), by repertoire id, for
 * My repertoires' "Assigned to N". One statement for all of them; no entry
 * for a repertoire whose rows reach no one.
 */
export async function coachAssigneeCounts(
  db: Executor,
  coachId: string,
): Promise<Map<string, number>> {
  const byRepertoire = new Map<string, { playerId: string }[]>();
  for (const pair of await reachedPairs(db, { coachId }))
    byRepertoire.set(pair.repertoireId, [
      ...(byRepertoire.get(pair.repertoireId) ?? []),
      pair,
    ]);
  return new Map(
    [...byRepertoire].map(([id, reached]) => [id, assigneeCount(reached)]),
  );
}
