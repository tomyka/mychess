/**
 * What a coach reads of their own assignments of one repertoire (R-46,
 * R-51, R-128, R-131). The domain decides access (canViewRepertoire: the
 * coach's own repertoire), the deadline (assignmentDeadline), the badges
 * (coachAssignmentBadges, through coachBadges, shared with the progress
 * reads) and who has it live (canUseAssignment); every statement filters
 * again on `assignments.coach_id`, and the rows on the repertoire's owner,
 * which assignments_repertoire_fk already guarantees is the coach. A player
 * is listed only while they are linked to the coach (the link check in
 * reach.ts). A fixed number of statements, whatever the number of players.
 */
import { playerKeys, type RepertoireGraph } from '@mychess/chess';
import {
  ownScope,
  assignmentDeadline,
  canUseAssignment,
  canViewRepertoire,
  type AssignmentFacts,
  type BadgeSet,
} from '@mychess/domain';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import { REPEATABLE_READ, type Executor } from '../client';
import { isUuid } from '../ids';
import { loadRepertoireRows } from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { accounts, groups, repertoires } from '../schema';
import { byName } from '../sort';
import { trackedReviews } from '../training/reviews';
import { coachBadges } from './badges';
import { namesOf } from './names';
import { assignmentFacts } from './reach';

/** One player an assignment reaches, as the coach sees them. */
export interface CoachAssignmentPlayer {
  readonly playerId: string;
  readonly displayName: string;
  /** effectiveDeadline across every row reaching the player (R-16, R-134). */
  readonly deadline: string | null;
  /**
   * What the coach sees on them (assignmentBadges), from assignmentStatus
   * at `now`: overdue and paused, or forked alone (R-46, R-51, R-128, R-132).
   */
  readonly badges: BadgeSet;
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

/** A reached player as the coach sees them, with the rows reaching them. */
interface Listed {
  readonly facts: AssignmentFacts;
  readonly player: CoachAssignmentPlayer;
}

/**
 * Each reached player's name, deadline and badges at `now` (coachBadges:
 * done when they learned every player move of `graph`, R-129). One read of
 * the Reviews of every player, of the repertoire's player moves only.
 */
async function listedOf(
  db: Executor,
  facts: readonly AssignmentFacts[],
  { graph, now }: { readonly graph: RepertoireGraph; readonly now: Date },
): Promise<Listed[]> {
  const playerIds = facts.map((one) => one.playerId);
  const names = await namesOf(db, playerIds);
  const tracked = await trackedReviews(db, playerIds, playerKeys(graph));
  return facts.map((one) => {
    // The reached player's account cascades away with their link.
    const displayName = names.get(one.playerId);
    if (displayName === undefined)
      throw new Error('coachAssignments: the player is gone');
    return {
      facts: one,
      player: {
        playerId: one.playerId,
        displayName,
        deadline: assignmentDeadline(one),
        badges: coachBadges(
          one,
          graph,
          tracked.get(one.playerId) ?? new Map(),
          now,
        ),
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

/** Players by name in Lithuanian order, then id. */
const byPlayerName = byName((one: CoachAssignmentPlayer) => ({
  name: one.displayName,
  id: one.playerId,
}));

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
    const loaded = await loadRepertoireRows(
      tx,
      repertoireScope(tx, ownScope(coachId), 'view', repertoireId),
    );
    if (
      loaded === undefined ||
      !canViewRepertoire({ id: coachId }, loaded.repertoire).ok
    )
      return [];
    const rows = await rowsOf(tx, coachId, repertoireId);
    const listed = await listedOf(
      tx,
      await assignmentFacts(tx, { coachId, repertoireId }),
      { graph: loaded.graph, now },
    );
    return rows.map((row) => ({
      id: row.id,
      target: targetOf(row),
      deadline: row.deadline,
      players: reachedBy(listed, row.id),
    }));
  }, REPEATABLE_READ);
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
    const facts = await assignmentFacts(tx, { coachId, repertoireId });
    return facts.filter((one) => canUseAssignment(one).ok).length;
  }, REPEATABLE_READ);
}
