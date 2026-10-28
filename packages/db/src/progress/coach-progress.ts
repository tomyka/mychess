/**
 * What a coach reads of their players' progress (R-151 to R-155). Every
 * read is one repeatable-read snapshot, so each takes the pool (`Db`), never
 * a caller's transaction. The facts are read first, inside that snapshot,
 * and the domain decides (isCoachLinked, progressRepertoire,
 * progressRepertoires). Each entry is then loaded through its scope
 * (entryRead): the coach's own for an assignment, live or forked, the
 * share for a shared one (Q26). Statements: fixed in the number of players,
 * plus 4 per repertoire shown (its row and the 3 of its graph).
 */
import {
  progressOf,
  type RepertoireProgress,
  type TrackedReview,
} from '@mychess/chess';
import {
  isCoachLinked,
  ownScope,
  progressRepertoire,
  progressRepertoires,
  type AccountRef,
  type BadgeSet,
  type CoachProgressFacts,
  type PlayerRepertoire,
  type ProgressSource,
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
  byName,
  entryRead,
  keysOf,
  loadAllVisible,
  loadVisible,
  type EntryRead,
  type LoadedGraph,
  type ProgressView,
  type ProgressViewer,
  type RepertoireRef,
} from './view';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;
const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/** One repertoire on the player page. */
export interface ProgressRow {
  readonly repertoire: RepertoireRef;
  /** The entry's source: assigned for a forked assignment too. */
  readonly source: ProgressSource;
  /** The S5 badges of an assignment; null for a shared repertoire. */
  readonly badges: BadgeSet | null;
  /** The standing where the domain grants it; forked otherwise (R-155). */
  readonly view: ProgressView;
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
  return facts !== undefined && isCoachLinked(coachId, playerId, facts)
    ? { coachId, playerId, facts }
    : undefined;
}

/** The Reviews of one player on the player moves of `shown`. */
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

/** A repertoire of progressRepertoires, loaded through its entryRead's scope. */
interface Shown {
  readonly loaded: LoadedGraph;
  readonly read: EntryRead;
}

/** A row of the player page; badges only for an assignment. */
function rowOf(
  { loaded, read }: Shown,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): ProgressRow {
  const reviewed = { graph: loaded.graph, tracked, now };
  return {
    repertoire: loaded.repertoire,
    source: read.source,
    badges: read.badges(reviewed),
    view: read.view(reviewed),
  };
}

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
    same.sort((a, b) => byName(a.loaded, b.loaded)),
  );
}

/**
 * Every repertoire of progressRepertoires its scope reaches: this coach's
 * assignments (by name), then the shared ones (by name).
 */
async function playerRepertoires(
  tx: Executor,
  viewer: ProgressViewer,
): Promise<Shown[]> {
  const out: Shown[] = [];
  const { coachId, playerId, facts } = viewer;
  for (const entry of progressRepertoires(coachId, playerId, facts)) {
    const read = entryRead(entry, viewer);
    const loaded = await loadVisible(tx, read.scope, entry.repertoireId);
    if (loaded !== undefined) out.push({ loaded, read });
  }
  return byNameWithinSource(out);
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
      rows: shown.map((one) => rowOf(one, tracked, now)),
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

/** Whose progress on which repertoire, asked by which coach. */
export interface RepertoireProgressRequest extends PlayerRepertoire {
  /** The acting coach: the session's, never one a client names. */
  readonly coachId: string;
}

/**
 * The progress page (R-152): undefined unless progressRepertoire grants
 * it. The repertoire then loads through that entry's scope.
 */
export function coachRepertoireProgress(
  db: Db,
  { coachId, playerId, repertoireId }: RepertoireProgressRequest,
  now: Date,
): Promise<RepertoireProgressView | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const viewer = await linkedViewer(tx, coachId, playerId);
    if (viewer === undefined) return undefined;
    const entry = progressRepertoire(
      coachId,
      playerId,
      repertoireId,
      viewer.facts,
    );
    if (entry?.kind !== 'granted') return undefined;
    const read = entryRead(entry, viewer);
    const loaded = await loadVisible(tx, read.scope, repertoireId);
    const player = await coachPlayer(tx, coachId, playerId);
    if (loaded === undefined || player === undefined) return undefined;
    const tracked = await trackedOf(tx, playerId, [loaded]);
    return {
      player: { id: player.id, displayName: player.displayName },
      repertoire: loaded.repertoire,
      badges: read.badges({ graph: loaded.graph, tracked, now }),
      progress: progressOf(loaded.graph, tracked, now),
    };
  }, SNAPSHOT);
}

/** One cell of the group grid; null where the member has no assignment. */
export interface GroupProgressCell {
  readonly badges: BadgeSet;
  /** The standing where the domain grants it; forked otherwise (R-155). */
  readonly view: ProgressView;
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
 * The member's cell of `column`: null unless progressRepertoire shows this
 * coach's assignment of it, live or forked; its badges, and its standing
 * only where granted.
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
  const read = entryRead(entry, viewer);
  const reviewed = { graph: column.graph, tracked, now };
  const badges = read.badges(reviewed);
  return badges === null ? null : { badges, view: read.view(reviewed) };
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
