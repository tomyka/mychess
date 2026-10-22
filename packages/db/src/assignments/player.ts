/**
 * What a player reads of the repertoires they have by assignment (R-16,
 * R-46, R-128, R-133, R-134). The domain decides access: each read keeps
 * only the assignmentFacts canUseAssignment allows (usableAssignments). The
 * query enforces it again: every statement filters by the session player
 * and reads the repertoire, its notes and its changes only through
 * the `assigned` repertoireScope. Each runs in one repeatable-read snapshot.
 */
import {
  allLearned,
  moveChangesSchema,
  netMoveChanges,
  type MoveChanges,
  type Side,
  type TrainingRepertoire,
} from '@mychess/chess';
import {
  ownScope,
  assignedScope,
  assignmentBadges,
  assignmentStatusOf,
  canUseAssignment,
  isTrainingActive,
  isUpdated,
  newsOf,
  type AssignmentFacts,
  type BadgeSet,
  type ChangeStamp,
  type SeenFacts,
} from '@mychess/domain';
import { and, asc, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { isUuid } from '../ids';
import { repertoireChanges } from '../assignment-schema';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { personalNotes, repertoires } from '../schema';
import { namesOf } from './names';
import { assignmentFacts } from './reach';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;

/**
 * The player's assignments canUseAssignment lets them use (assigned now,
 * not forked), by repertoire id; of one repertoire when `repertoireId` is given.
 */
async function usableAssignments(
  db: Executor,
  playerId: string,
  repertoireId?: string,
): Promise<AssignmentFacts[]> {
  const facts = await assignmentFacts(
    db,
    repertoireId === undefined
      ? { playerIds: [playerId] }
      : { playerIds: [playerId], repertoireId },
  );
  return facts.filter((one) => canUseAssignment(one).ok);
}

/** The player's usable assignment of `repertoireId`, else undefined. */
async function usableAssignment(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<AssignmentFacts | undefined> {
  const [usable] = await usableAssignments(db, playerId, repertoireId);
  return usable;
}

/** What "Updated" and the news of a change depend on (R-133, R-136). */
const seenFacts = (assignment: AssignmentFacts): SeenFacts => ({
  seenVersion: assignment.seenVersion,
  starts: assignment.reaches,
});

/** Until S6 writes Reviews, no move is learned (R-129). */
export const NOTHING_LEARNED: ReadonlySet<string> = new Set();

/** One repertoire a player has from their coach, for "From my coach". */
export interface PlayerAssignment {
  readonly repertoireId: string;
  readonly name: string;
  readonly side: Side;
  readonly coachId: string;
  readonly coachName: string;
  /** effectiveDeadline: `YYYY-MM-DD` or null (R-16, R-134). */
  readonly deadline: string | null;
  readonly paused: boolean;
  /** Every player move learned (R-129). */
  readonly done: boolean;
  /**
   * What the player sees on it at `now` (assignmentBadges): overdue
   * (R-51, R-132), paused (R-46) and "Updated", a coach change they have
   * not opened (R-133).
   */
  readonly badges: BadgeSet;
}

const latestRowsSchema = z.array(
  z.object({
    repertoireId: z.uuid(),
    version: z.number().int(),
    createdAt: z.date(),
  }),
);

/** Each repertoire's latest change for players: its version and time. */
async function latestChanges(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, ChangeStamp>> {
  if (ids.length === 0) return new Map();
  const rows = latestRowsSchema.parse(
    await db
      .selectDistinctOn([repertoireChanges.repertoireId], {
        repertoireId: repertoireChanges.repertoireId,
        version: repertoireChanges.version,
        createdAt: repertoireChanges.createdAt,
      })
      .from(repertoireChanges)
      .where(inArray(repertoireChanges.repertoireId, [...ids]))
      .orderBy(
        asc(repertoireChanges.repertoireId),
        desc(repertoireChanges.version),
      ),
  );
  return new Map(
    rows.map(({ repertoireId, ...stamp }) => [repertoireId, stamp]),
  );
}

/**
 * Each assignment the player may use (canUseAssignment) with its
 * repertoire, loaded through the `assigned` repertoireScope.
 */
async function loadLive(
  tx: Executor,
  playerId: string,
): Promise<{ assignment: AssignmentFacts; loaded: LoadedRepertoire }[]> {
  const live = [];
  for (const assignment of await usableAssignments(tx, playerId)) {
    const loaded = await loadRepertoireRows(
      tx,
      repertoireScope(
        tx,
        assignedScope(playerId),
        'view',
        assignment.repertoireId,
      ),
    );
    if (loaded !== undefined) live.push({ assignment, loaded });
  }
  return live;
}

interface ItemFacts {
  readonly assignment: AssignmentFacts;
  readonly loaded: LoadedRepertoire;
  readonly coachName: string;
  readonly latest: ChangeStamp | undefined;
}

/** What the domain says of a live assignment at `now` (R-16, R-46, R-51, R-129, R-134). */
interface LiveStatus {
  readonly deadline: string | null;
  readonly paused: boolean;
  readonly done: boolean;
  readonly overdue: boolean;
}

function statusOf(
  {
    assignment,
    loaded,
  }: { assignment: AssignmentFacts; loaded: LoadedRepertoire },
  now: Date,
): LiveStatus {
  const done = allLearned(loaded.graph, NOTHING_LEARNED);
  const status = assignmentStatusOf(assignment, { done, now });
  return {
    deadline: status.deadline,
    paused: status.paused,
    done: status.done,
    overdue: status.overdue,
  };
}

function itemOf(facts: ItemFacts, now: Date): PlayerAssignment {
  const { assignment, loaded } = facts;
  const { deadline, paused, done, overdue } = statusOf(facts, now);
  const updated = isUpdated(seenFacts(assignment), facts.latest);
  return {
    repertoireId: assignment.repertoireId,
    name: loaded.repertoire.name,
    side: loaded.repertoire.side,
    coachId: assignment.coachId,
    coachName: facts.coachName,
    deadline,
    paused,
    done,
    badges: assignmentBadges({ audience: 'player', overdue, paused, updated }),
  };
}

/**
 * The repertoires `playerId` has live from their coaches, one entry each,
 * by name (R-16: individual and group assignments merged; R-128: forked
 * ones left out).
 */
export function playerAssignments(
  db: Executor,
  playerId: string,
  now: Date,
): Promise<PlayerAssignment[]> {
  return db.transaction(async (tx) => {
    const live = await loadLive(tx, playerId);
    const names = await namesOf(
      tx,
      live.map(({ assignment }) => assignment.coachId),
    );
    const latest = await latestChanges(
      tx,
      live.map(({ assignment }) => assignment.repertoireId),
    );
    return live
      .map((entry) =>
        itemOf(
          {
            ...entry,
            coachName: names.get(entry.assignment.coachId) ?? '',
            latest: latest.get(entry.assignment.repertoireId),
          },
          now,
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'lt'));
  }, SNAPSHOT);
}

/** An assigned repertoire as its player opens it (R-21, R-102). */
export interface AssignedRepertoire extends LoadedRepertoire {
  readonly coachName: string;
  /** The player's own notes on it, by move key. */
  readonly personalNotes: Readonly<Record<string, string>>;
  readonly paused: boolean;
  /** effectiveDeadline: `YYYY-MM-DD` or null (R-16, R-134). */
  readonly deadline: string | null;
  /** assignmentStatus at `now` (R-51). */
  readonly overdue: boolean;
}

const noteRowsSchema = z.array(
  z.object({ moveKey: z.string().min(1), text: z.string() }),
);

/** The repertoire's id while it is live for the player, as a subquery. */
const liveId = (db: Executor, playerId: string, repertoireId: string) =>
  db
    .select({ id: repertoires.id })
    .from(repertoires)
    .where(repertoireScope(db, assignedScope(playerId), 'view', repertoireId));

async function notesOf(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<Record<string, string>> {
  const rows = noteRowsSchema.parse(
    await db
      .select({ moveKey: personalNotes.moveKey, text: personalNotes.text })
      .from(personalNotes)
      .where(
        and(
          eq(personalNotes.playerAccountId, playerId),
          inArray(
            personalNotes.repertoireId,
            liveId(db, playerId, repertoireId),
          ),
        ),
      ),
  );
  return Object.fromEntries(rows.map((row) => [row.moveKey, row.text]));
}

/** The player's live assignment of the repertoire with the repertoire, or undefined. */
async function openLive(
  tx: Executor,
  playerId: string,
  repertoireId: string,
): Promise<
  { assignment: AssignmentFacts; loaded: LoadedRepertoire } | undefined
> {
  const assignment = await usableAssignment(tx, playerId, repertoireId);
  if (assignment === undefined) return undefined;
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, assignedScope(playerId), 'view', repertoireId),
  );
  return loaded === undefined ? undefined : { assignment, loaded };
}

/**
 * Repertoire `repertoireId` as `playerId` has it by assignment, with the
 * coach's comments (R-102), the coach's name, the player's own notes and
 * its deadline and overdue as of `now`; undefined unless it is assigned to
 * them now and not forked.
 */
export function assignedRepertoireForPlayer(
  db: Executor,
  playerId: string,
  repertoireId: string,
  now: Date,
): Promise<AssignedRepertoire | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const opened = await openLive(tx, playerId, repertoireId);
    if (opened === undefined) return undefined;
    const { loaded } = opened;
    const names = await namesOf(tx, [loaded.repertoire.ownerId]);
    const { paused, deadline, overdue } = statusOf(opened, now);
    return {
      ...loaded,
      coachName: names.get(loaded.repertoire.ownerId) ?? '',
      personalNotes: await notesOf(tx, playerId, repertoireId),
      paused,
      deadline,
      overdue,
    };
  }, SNAPSHOT);
}

/** What changed since the player last saw a repertoire (R-133). */
export interface ChangesSince {
  /** The net of every change since, by move and chapter. */
  readonly changes: MoveChanges;
}

/** The player, the repertoire and the version their page showed. */
export interface ChangesRequest {
  /** The session account, never a client value. */
  readonly playerId: string;
  readonly repertoireId: string;
  /**
   * The repertoire version the page read with its graph: changes after it
   * wait for the next visit, so the summary matches the graph shown.
   */
  readonly upToVersion: number;
}

const changeRowsSchema = z.array(
  z.object({
    version: z.number().int(),
    createdAt: z.date(),
    changes: moveChangesSchema,
  }),
);

/**
 * The net of the changes to the player's live assignment that are news to
 * them (newsOf: after the version they last saw and after they had it,
 * R-133, R-136), up to and including `upToVersion`, in version order;
 * undefined unless it is theirs.
 */
export function changesSince(
  db: Executor,
  { playerId, repertoireId, upToVersion }: ChangesRequest,
): Promise<ChangesSince | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const assignment = await usableAssignment(tx, playerId, repertoireId);
    if (assignment === undefined) return undefined;
    const rows = changeRowsSchema.parse(
      await tx
        .select({
          version: repertoireChanges.version,
          createdAt: repertoireChanges.createdAt,
          changes: repertoireChanges.changes,
        })
        .from(repertoireChanges)
        .where(
          and(
            inArray(
              repertoireChanges.repertoireId,
              liveId(tx, playerId, repertoireId),
            ),
            gt(repertoireChanges.version, assignment.seenVersion ?? 0),
            lte(repertoireChanges.version, upToVersion),
          ),
        )
        .orderBy(asc(repertoireChanges.version)),
    );
    const news = newsOf(seenFacts(assignment), rows);
    return { changes: netMoveChanges(news.map((row) => row.changes)) };
  }, SNAPSHOT);
}

const ownRowsSchema = z.array(z.object({ id: z.uuid() }));

/** The player's own repertoires, oldest first; always active. */
async function ownTraining(
  tx: Executor,
  playerId: string,
): Promise<TrainingRepertoire[]> {
  const owned = ownRowsSchema.parse(
    await tx
      .select({ id: repertoires.id })
      .from(repertoires)
      .where(repertoireScope(tx, ownScope(playerId), 'view'))
      .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
  );
  const out: TrainingRepertoire[] = [];
  for (const { id } of owned) {
    const loaded = await loadRepertoireRows(
      tx,
      repertoireScope(tx, ownScope(playerId), 'view', id),
    );
    if (loaded !== undefined)
      out.push({ id, graph: loaded.graph, active: true });
  }
  return out;
}

/**
 * Every repertoire `playerId` trains (S6's seam, lead decision 9): their
 * own, then those they have live by assignment, a paused one inactive
 * (R-46). A forked one is absent; the fork is one of their own (R-128).
 */
export function trainingRepertoires(
  db: Executor,
  playerId: string,
): Promise<TrainingRepertoire[]> {
  return db.transaction(async (tx) => {
    const own = await ownTraining(tx, playerId);
    const assigned = (await loadLive(tx, playerId)).map(
      ({ assignment, loaded }) => ({
        id: assignment.repertoireId,
        graph: loaded.graph,
        active: isTrainingActive(assignment.pausedAt),
      }),
    );
    return [...own, ...assigned];
  }, SNAPSHOT);
}
