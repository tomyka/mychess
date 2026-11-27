/**
 * What a coach reads of their players' progress (R-151 to R-155). Every
 * read is one repeatable-read snapshot, so each takes the pool (`Db`), never
 * a caller's transaction. The facts are read first, inside that snapshot,
 * and the domain decides (isCoachLinked, progressRepertoire,
 * progressRepertoires). Each entry is then loaded through its scope
 * (entryRead): the coach's own for an assignment, live or forked, the
 * share for a shared one (Q26). Statements: fixed in the number of players,
 * plus 4 per repertoire shown (its row and the 3 of its graph). The player
 * page reads through coachPlayerProgress, the progress page through
 * coachRepertoireProgress, whose one-repertoire access step (grantedReads,
 * granted.ts) it shares with coachAssigneeStandings. The dashboard
 * (dashboard.ts) builds each player's rows as the player page does
 * (playerRepertoires, rowOf); the group page is composed in pages.ts, the
 * group grid from groupGrid here.
 */
import {
  progressOf,
  type RepertoireGraph,
  type RepertoireProgress,
  type TrackedReview,
} from '@mychess/chess';
import {
  isCoachLinked,
  ownScope,
  progressRepertoire,
  progressRepertoires,
  type AccountRef,
  type CoachProgressFacts,
  type CoachView,
  type PlayerRepertoire,
  type ProgressSource,
  type RepertoireScope,
} from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import type { CoachStatus } from '../assignments/status';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { coachPlayer, type LinkedAccount } from '../coaching';
import type { CoachGroup, GroupMember } from '../groups';
import { isUuid } from '../ids';
import { trackedReviews } from '../training/reviews';
import { coachProgressFacts, lastTrained } from './facts';
import { grantedReads } from './granted';
import {
  byRepertoireName,
  entryRead,
  keysOf,
  loadAllVisible,
  loadVisible,
  type EntryRead,
  type LoadedGraph,
  type ProgressViewer,
  type RepertoireRef,
} from './view';

const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/** The player page: the player, and where they stand. */
export interface PlayerProgress {
  /** The player, linked to the coach, with the coach's own groups. */
  readonly player: LinkedAccount;
  /** The Coach view of each repertoire the page shows. */
  readonly rows: readonly CoachView[];
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
  return facts !== undefined && isCoachLinked(coachId, playerId, facts)
    ? { coachId, playerId, facts }
    : undefined;
}

/** A player the domain finds linked, and the player as the link reads them. */
interface LinkedPlayer {
  readonly viewer: ProgressViewer;
  readonly player: LinkedAccount;
}

/**
 * The viewer and the player when isCoachLinked, the player read by the
 * same link again (coachPlayer joins coach_links); undefined otherwise.
 */
async function linkedPlayer(
  tx: Executor,
  coachId: string,
  playerId: string,
): Promise<LinkedPlayer | undefined> {
  const viewer = await linkedViewer(tx, coachId, playerId);
  if (viewer === undefined) return undefined;
  const player = await coachPlayer(tx, coachId, playerId);
  return player === undefined ? undefined : { viewer, player };
}

/** The Reviews of one player on the player moves of `shown`. */
async function trackedReviewsOf(
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

/** A repertoire of progressRepertoires, loaded through its entryRead's scope. */
export interface Shown {
  readonly loaded: LoadedGraph;
  readonly read: EntryRead;
}

/** A row of the player page: its Coach view. */
export const rowOf = (
  { loaded, read }: Shown,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): CoachView => read.coachView(loaded, tracked, now);

/**
 * `shown` in the domain's order of sources, each source by name: the
 * domain decides which source comes first, the page only sorts within it.
 */
function byNameWithinSource(shown: readonly Shown[]): Shown[] {
  const bySource = new Map<ProgressSource, Shown[]>();
  for (const one of shown) {
    const same = bySource.get(one.read.source) ?? [];
    same.push(one);
    bySource.set(one.read.source, same);
  }
  return [...bySource.values()].flatMap((same) =>
    same.sort((a, b) => byRepertoireName(a.loaded, b.loaded)),
  );
}

/** Loads a repertoire as a scope reaches it for viewing (loadVisible). */
export type LoadVisible = (
  scope: RepertoireScope,
  id: string,
) => Promise<LoadedGraph | undefined>;

/**
 * Every repertoire of progressRepertoires its scope reaches, as `load`
 * loads it: this coach's assignments (by name), then the shared ones (by
 * name). The viewer must be one isCoachLinked found linked.
 */
export async function playerRepertoires(
  load: LoadVisible,
  viewer: ProgressViewer,
): Promise<Shown[]> {
  const out: Shown[] = [];
  const { coachId, playerId, facts } = viewer;
  for (const entry of progressRepertoires(coachId, playerId, facts)) {
    const read = entryRead(entry, viewer);
    const loaded = await load(read.scope, entry.repertoireId);
    if (loaded !== undefined) out.push({ loaded, read });
  }
  return byNameWithinSource(out);
}

/**
 * The player page, its one read: the player (by the same link again),
 * every repertoire this coach assigned them (by name), then every one they
 * share with the coach (by name), and when they last trained. Undefined
 * unless isCoachLinked.
 */
export function coachPlayerProgress(
  db: Db,
  coachId: string,
  playerId: string,
  now: Date,
): Promise<PlayerProgress | undefined> {
  return db.transaction(async (tx) => {
    const linked = await linkedPlayer(tx, coachId, playerId);
    if (linked === undefined) return undefined;
    const { viewer, player } = linked;
    const shown = await playerRepertoires(
      (scope, id) => loadVisible(tx, scope, id),
      viewer,
    );
    const tracked = await trackedReviewsOf(
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
      player,
      rows: shown.map((one) => rowOf(one, tracked, now)),
      lastTrained: last.get(playerId) ?? null,
    };
  }, REPEATABLE_READ);
}

/**
 * One player's progress on one repertoire, chapters and lines included,
 * with its Coach view.
 */
export interface RepertoireProgressView extends CoachView {
  readonly player: AccountRef;
  /** Its graph as loaded, so the page titles its chapters without a second read. */
  readonly graph: RepertoireGraph;
  readonly progress: RepertoireProgress;
}

/** Whose progress on which repertoire, asked by which coach. */
export interface RepertoireProgressRequest extends PlayerRepertoire {
  /** The acting coach: the session's, never one a client names. */
  readonly coachId: string;
}

/**
 * The progress page (R-152): undefined unless the access step
 * (grantedReads) grants it. The player's name is read by the link
 * (coachPlayer), and the repertoire loads through that entry's scope.
 */
export function coachRepertoireProgress(
  db: Db,
  { coachId, playerId, repertoireId }: RepertoireProgressRequest,
  now: Date,
): Promise<RepertoireProgressView | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const [granted] = await grantedReads(tx, coachId, repertoireId, [playerId]);
    if (granted === undefined) return undefined;
    const player = await coachPlayer(tx, coachId, playerId);
    if (player === undefined) return undefined;
    const { read } = granted;
    const loaded = await loadVisible(tx, read.scope, repertoireId);
    if (loaded === undefined) return undefined;
    const tracked = await trackedReviewsOf(tx, playerId, [loaded]);
    return {
      ...read.coachView(loaded, tracked, now),
      player: { id: player.id, displayName: player.displayName },
      graph: loaded.graph,
      progress: progressOf(loaded.graph, tracked, now),
    };
  }, REPEATABLE_READ);
}

/**
 * One cell of the group grid, the member's Coach view of the column's
 * assignment; null where the member has no assignment.
 */
export interface GroupProgressCell extends Pick<CoachView, 'view'> {
  /** The assignment's deadline and status, as on the player page. */
  readonly status: CoachStatus;
}

/**
 * One column of the group grid: a repertoire assigned to the group, its
 * deadline, and how many members hold it live and how many of them are
 * done. A member with their own copy does not hold it live (R-155).
 */
export interface GroupColumn extends RepertoireRef {
  /** A calendar date (YYYY-MM-DD); null for none. */
  readonly deadline: string | null;
  readonly done: number;
  readonly count: number;
}

export interface GroupProgressRow {
  readonly player: AccountRef;
  readonly lastTrained: Date | null;
  /** One per column, in column order. */
  readonly cells: readonly (GroupProgressCell | null)[];
}

export interface GroupProgress {
  readonly columns: readonly GroupColumn[];
  readonly rows: readonly GroupProgressRow[];
}

const groupAssignmentRowsSchema = z.array(
  z.object({ id: z.uuid(), deadline: z.iso.date().nullable() }),
);

/**
 * The repertoires this coach assigned to the group, each once (one
 * assignment per repertoire and group), with the assignment's deadline.
 */
async function groupRepertoireDeadlines(
  tx: Executor,
  coachId: string,
  groupId: string,
): Promise<Map<string, string | null>> {
  const rows = groupAssignmentRowsSchema.parse(
    await tx
      .select({ id: assignments.repertoireId, deadline: assignments.deadline })
      .from(assignments)
      .where(
        and(eq(assignments.coachId, coachId), eq(assignments.groupId, groupId)),
      ),
  );
  return new Map(rows.map((row) => [row.id, row.deadline]));
}

/** How many of a column's cells hold it live, and how many of those are done. */
function doneOf(
  rows: readonly GroupProgressRow[],
  index: number,
): Pick<GroupColumn, 'done' | 'count'> {
  const live = rows.flatMap(({ cells }) => {
    const cell = cells[index];
    return cell === undefined || cell === null || cell.view.kind === 'forked'
      ? []
      : [cell];
  });
  return {
    done: live.filter(({ status }) => status.done).length,
    count: live.length,
  };
}

/**
 * The member's cell of `column`: null unless progressRepertoire shows this
 * coach's assignment of it, live or forked; its status, and its
 * standing only where granted.
 */
function cellOf(
  viewer: ProgressViewer,
  column: LoadedGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): GroupProgressCell | null {
  const { coachId, playerId, facts } = viewer;
  const id = column.repertoire.id;
  const entry = progressRepertoire(coachId, playerId, id, facts);
  if (entry === undefined) return null;
  const { status, view } = entryRead(entry, viewer).coachView(
    column,
    tracked,
    now,
  );
  return status === null ? null : { status, view };
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
  if (facts === undefined) throw new Error('groupGrid: a member has no facts');
  const viewer = { coachId: reads.coachId, playerId: member.id, facts };
  const tracked = reads.tracked.get(member.id) ?? NO_REVIEWS;
  return {
    player: { id: member.id, displayName: member.displayName },
    lastTrained: reads.last.get(member.id) ?? null,
    cells: reads.columns.map((column) => cellOf(viewer, column, tracked, now)),
  };
}

/**
 * The members this coach is linked to (isCoachLinked): only their Reviews
 * are read (trackedReviews itself is ungated).
 */
const linkedIds = (
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): string[] =>
  [...facts]
    .filter(([id, one]) => isCoachLinked(coachId, id, one))
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

/** The grid of the coach's own `group`, read in the caller's snapshot (pages.ts). */
export async function groupGrid(
  tx: Executor,
  coachId: string,
  group: CoachGroup,
  now: Date,
): Promise<GroupProgress> {
  const deadlines = await groupRepertoireDeadlines(tx, coachId, group.id);
  const columns = await loadAllVisible(tx, ownScope(coachId), [
    ...deadlines.keys(),
  ]);
  const reads = await groupReads(
    tx,
    coachId,
    columns,
    group.members.map((m) => m.id),
  );
  const rows = group.members.map((member) => memberRow(reads, member, now));
  return {
    columns: columns.map(({ repertoire }, index) => ({
      ...repertoire,
      deadline: deadlines.get(repertoire.id) ?? null,
      ...doneOf(rows, index),
    })),
    rows,
  };
}
