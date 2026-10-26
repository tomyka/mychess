/**
 * What a coach reads of their players' progress (R-151 to R-155). Every
 * read is one repeatable-read snapshot, so each takes the pool (`Db`), never
 * a caller's transaction. The facts are read first, inside that snapshot,
 * and the domain decides (canCoachSee, canCoachSeeProgress). The
 * repertoires are then loaded through the same scopes again: the coach's
 * own for an assignment, the share for a shared one (Q26). Statements:
 * fixed in the number of players, plus 4 per repertoire shown (its row and
 * the 3 of its graph).
 */
import {
  progressOf,
  type RepertoireProgress,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import {
  canCoachSee,
  canCoachSeeProgress,
  ownScope,
  sharedScope,
  type AccountRef,
  type BadgeSet,
  type CoachProgressFacts,
  type PlayerRepertoire,
} from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import type { Db, Executor } from '../client';
import { coachPlayer } from '../coaching';
import { coachGroup, type GroupMember } from '../groups';
import { isUuid } from '../ids';
import { trackedReviews } from '../training/reviews';
import { coachProgressFacts, lastTrained } from './facts';
import {
  coachBadges,
  keysOf,
  loadAllVisible,
  loadVisible,
  standingFor,
  type LoadedGraph,
  type ProgressViewer,
  type RepertoireRef,
} from './view';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;
const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/** Where a repertoire on the player page comes from. */
type ProgressSource = 'assigned' | 'shared';

/** One repertoire on the player page. */
export interface ProgressRow {
  readonly repertoire: RepertoireRef;
  readonly source: ProgressSource;
  /** The S5 badges of an assignment; null for a shared repertoire. */
  readonly badges: BadgeSet | null;
  /** Null where canCoachSeeProgress refuses: a forked assignment (R-155). */
  readonly standing: Standing | null;
}

export interface PlayerProgress {
  readonly rows: readonly ProgressRow[];
  readonly lastTrained: Date | null;
}

/** The facts of one player, linked to the coach; undefined otherwise. */
async function linkedViewer(
  tx: Executor,
  coachId: string,
  playerId: string,
): Promise<ProgressViewer | undefined> {
  const facts = (await coachProgressFacts(tx, coachId, [playerId])).get(
    playerId,
  );
  return facts !== undefined &&
    canCoachSee(coachId, playerId, { kind: 'profile' }, facts).ok
    ? { coachId, playerId, facts }
    : undefined;
}

/** The Reviews of one player on the own moves of `shown`. */
async function trackedOf(
  tx: Executor,
  playerId: string,
  shown: readonly LoadedGraph[],
): Promise<ReadonlyMap<string, TrackedReview>> {
  const read = await trackedReviews(
    tx,
    [playerId],
    keysOf(shown.map((one) => one.graph)),
  );
  return read.get(playerId) ?? NO_REVIEWS;
}

/** The assignment of `repertoireId` among the viewer's facts, if any. */
const assignmentOf = (facts: CoachProgressFacts, repertoireId: string) =>
  facts.assignments.find((a) => a.repertoireId === repertoireId);

/** The S5 badges of this coach's assignment of `loaded`; null for none. */
function badgesOf(
  facts: CoachProgressFacts,
  loaded: LoadedGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet | null {
  const assignment = assignmentOf(facts, loaded.repertoire.id);
  return assignment === undefined
    ? null
    : coachBadges(assignment, loaded.graph, tracked, now);
}

/** A repertoire on the player page and the list it was loaded from. */
interface Shown {
  readonly loaded: LoadedGraph;
  readonly source: ProgressSource;
}

/** A row of the player page; badges only for an assignment. */
function rowOf(
  viewer: ProgressViewer,
  { loaded, source }: Shown,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): ProgressRow {
  return {
    repertoire: loaded.repertoire,
    source,
    badges:
      source === 'assigned'
        ? badgesOf(viewer.facts, loaded, tracked, now)
        : null,
    standing: standingFor(viewer, loaded, tracked, now),
  };
}

const shownAs =
  (source: ProgressSource) =>
  (loaded: LoadedGraph): Shown => ({ loaded, source });

/** Every repertoire this coach assigned the player, then every shared one. */
async function playerRepertoires(
  tx: Executor,
  { coachId, playerId, facts }: ProgressViewer,
): Promise<Shown[]> {
  const assigned = await loadAllVisible(
    tx,
    ownScope(coachId),
    facts.assignments.map((a) => a.repertoireId),
  );
  const shared = await loadAllVisible(
    tx,
    sharedScope(coachId, playerId),
    facts.sharedRepertoireIds,
  );
  return [
    ...assigned.map(shownAs('assigned')),
    ...shared.map(shownAs('shared')),
  ];
}

/**
 * The player page's progress: every repertoire this coach assigned the
 * player (by name), then every one the player shares with them (by name),
 * and when they last trained. Undefined unless linked.
 */
export function coachPlayerProgress(
  db: Db,
  coachId: string,
  playerId: string,
  now: Date,
): Promise<PlayerProgress | undefined> {
  return db.transaction(async (tx) => {
    const viewer = await linkedViewer(tx, coachId, playerId);
    if (viewer === undefined) return undefined;
    const shown = await playerRepertoires(tx, viewer);
    const tracked = await trackedOf(
      tx,
      playerId,
      shown.map((one) => one.loaded),
    );
    const last = await lastTrained(
      tx,
      coachId,
      new Map([[playerId, viewer.facts]]),
    );
    return {
      rows: shown.map((one) => rowOf(viewer, one, tracked, now)),
      lastTrained: last.get(playerId) ?? null,
    };
  }, SNAPSHOT);
}

/** One player's progress on one repertoire, chapters and lines included. */
export interface RepertoireProgressView {
  readonly player: AccountRef;
  readonly repertoire: RepertoireRef;
  readonly badges: BadgeSet | null;
  readonly progress: RepertoireProgress;
}

/** The repertoire through the scope canCoachSeeProgress allowed it by. */
function loadAllowed(
  tx: Executor,
  { coachId, playerId, facts }: ProgressViewer,
  repertoireId: string,
): Promise<LoadedGraph | undefined> {
  const scope = facts.sharedRepertoireIds.has(repertoireId)
    ? sharedScope(coachId, playerId)
    : ownScope(coachId);
  return loadVisible(tx, scope, repertoireId);
}

/** Whose progress on which repertoire, asked by which coach. */
export interface RepertoireProgressRequest extends PlayerRepertoire {
  /** The acting coach: the session's, never one a client names. */
  readonly coachId: string;
}

/**
 * The progress page (R-152): undefined unless canCoachSeeProgress allows
 * it. The repertoire then loads through the scope that allowed it.
 */
export function coachRepertoireProgress(
  db: Db,
  { coachId, playerId, repertoireId }: RepertoireProgressRequest,
  now: Date,
): Promise<RepertoireProgressView | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const viewer = await linkedViewer(tx, coachId, playerId);
    if (
      viewer === undefined ||
      !canCoachSeeProgress(coachId, playerId, repertoireId, viewer.facts).ok
    )
      return undefined;
    const loaded = await loadAllowed(tx, viewer, repertoireId);
    const player = await coachPlayer(tx, coachId, playerId);
    if (loaded === undefined || player === undefined) return undefined;
    const tracked = await trackedOf(tx, playerId, [loaded]);
    return {
      player: { id: player.id, displayName: player.displayName },
      repertoire: loaded.repertoire,
      badges: badgesOf(viewer.facts, loaded, tracked, now),
      progress: progressOf(loaded.graph, tracked, now),
    };
  }, SNAPSHOT);
}

/** One cell of the group grid; null where the member has no assignment. */
export interface GroupProgressCell {
  readonly badges: BadgeSet;
  /** Null where canCoachSeeProgress refuses: a forked assignment (R-155). */
  readonly standing: Standing | null;
}

export interface GroupProgressRow {
  readonly player: AccountRef;
  readonly lastTrained: Date | null;
  /** One per column, in column order. */
  readonly cells: readonly (GroupProgressCell | null)[];
}

export interface GroupProgress {
  readonly columns: readonly RepertoireRef[];
  readonly rows: readonly GroupProgressRow[];
}

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

/** The repertoires this coach assigned to the group, each once. */
async function groupRepertoireIds(
  tx: Executor,
  coachId: string,
  groupId: string,
): Promise<string[]> {
  const rows = idRowsSchema.parse(
    await tx
      .selectDistinct({ id: assignments.repertoireId })
      .from(assignments)
      .where(
        and(eq(assignments.coachId, coachId), eq(assignments.groupId, groupId)),
      ),
  );
  return rows.map((row) => row.id);
}

/**
 * The member's cell of `column`: null without an assignment of it; its
 * badges, and its standing only where canCoachSeeProgress allows it.
 */
function cellOf(
  viewer: ProgressViewer,
  column: LoadedGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): GroupProgressCell | null {
  const assignment = assignmentOf(viewer.facts, column.repertoire.id);
  if (assignment === undefined) return null;
  return {
    badges: coachBadges(assignment, column.graph, tracked, now),
    standing: standingFor(viewer, column, tracked, now),
  };
}

/** What the grid knows of every member, read once for the whole group. */
interface GroupReads {
  readonly coachId: string;
  readonly columns: readonly LoadedGraph[];
  readonly facts: ReadonlyMap<string, CoachProgressFacts>;
  readonly tracked: ReadonlyMap<string, ReadonlyMap<string, TrackedReview>>;
  readonly last: ReadonlyMap<string, Date>;
}

/** One member's row. */
function memberRow(
  reads: GroupReads,
  member: GroupMember,
  now: Date,
): GroupProgressRow {
  const facts = reads.facts.get(member.id);
  // coachProgressFacts has an entry for every id it was asked about.
  if (facts === undefined)
    throw new Error('coachGroupProgress: a member has no facts');
  const viewer = { coachId: reads.coachId, playerId: member.id, facts };
  const tracked = reads.tracked.get(member.id) ?? NO_REVIEWS;
  return {
    player: { id: member.id, displayName: member.displayName },
    lastTrained: reads.last.get(member.id) ?? null,
    cells: reads.columns.map((column) => cellOf(viewer, column, tracked, now)),
  };
}

/**
 * The members canCoachSee lets this coach see at all: only their Reviews
 * are read (trackedReviews itself is ungated).
 */
const linkedIds = (
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): string[] =>
  [...facts]
    .filter(
      ([id, one]) => canCoachSee(coachId, id, { kind: 'profile' }, one).ok,
    )
    .map(([id]) => id);

/**
 * The grid's facts, Reviews and last-trained times: fixed in members. The
 * facts are read here, in the grid's snapshot, never passed in.
 */
async function groupReads(
  tx: Executor,
  coachId: string,
  columns: readonly LoadedGraph[],
  memberIds: readonly string[],
): Promise<GroupReads> {
  const facts = await coachProgressFacts(tx, coachId, memberIds);
  const tracked = await trackedReviews(
    tx,
    linkedIds(coachId, facts),
    keysOf(columns.map((c) => c.graph)),
  );
  const last = await lastTrained(tx, coachId, facts);
  return { coachId, columns, facts, tracked, last };
}

/**
 * The group grid (R-153): the coach's own group, one column per
 * repertoire assigned to it (by name), one row per member (by name).
 * Undefined for any other group.
 */
export function coachGroupProgress(
  db: Db,
  coachId: string,
  groupId: string,
  now: Date,
): Promise<GroupProgress | undefined> {
  return db.transaction(async (tx) => {
    const group = await coachGroup(tx, coachId, groupId);
    if (group === undefined) return undefined;
    const columns = await loadAllVisible(
      tx,
      ownScope(coachId),
      await groupRepertoireIds(tx, coachId, groupId),
    );
    const reads = await groupReads(
      tx,
      coachId,
      columns,
      group.members.map((m) => m.id),
    );
    return {
      columns: columns.map((c) => c.repertoire),
      rows: group.members.map((member) => memberRow(reads, member, now)),
    };
  }, SNAPSHOT);
}

/** When each of `playerIds` last trained, as the coach may see it (R-154). */
export function coachLastTrained(
  db: Db,
  coachId: string,
  playerIds: readonly string[],
): Promise<Map<string, Date>> {
  return db.transaction(
    async (tx) =>
      lastTrained(
        tx,
        coachId,
        await coachProgressFacts(tx, coachId, playerIds),
      ),
    SNAPSHOT,
  );
}
