/**
 * What a player reads of the repertoires they have by assignment (R-16,
 * R-46, R-128, R-133, R-134). The domain decides access: each read keeps
 * only the assignments canUseAssignment allows (usableAssignments). The
 * query enforces it again: every statement filters by the session player
 * and reads the repertoire, its notes and its changes only through
 * liveRepertoire. Each runs in one repeatable-read snapshot.
 */
import {
  allLearned,
  netMoveChanges,
  type MoveChanges,
  type Side,
  type TrainingRepertoire,
} from '@mychess/chess';
import {
  assignmentStatus,
  effectiveDeadline,
  isTrainingActive,
  isUpdated,
  seenFloor,
} from '@mychess/domain';
import { and, asc, eq, gt, inArray, lte, max } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { isUuid } from '../ids';
import { repertoireChanges } from '../assignment-schema';
import {
  loadRepertoireRows,
  ownedBy,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { accounts, personalNotes, repertoires } from '../schema';
import { liveRepertoire, usableAssignment, usableAssignments } from './access';
import type { EffectiveAssignment } from './effective';
import { moveChangesSchema } from './move-changes';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;

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
  /** The coach changed it since the player last opened it (R-133). */
  readonly updated: boolean;
  /** Every player move learned (R-129). */
  readonly done: boolean;
  /** assignmentStatus at `now` (R-51, R-132). */
  readonly overdue: boolean;
}

const nameRowsSchema = z.array(
  z.object({ id: z.string().min(1), displayName: z.string() }),
);

/** Display names by account id. */
async function namesOf(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = nameRowsSchema.parse(
    await db
      .select({ id: accounts.id, displayName: accounts.displayName })
      .from(accounts)
      .where(inArray(accounts.id, [...new Set(ids)])),
  );
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

const latestRowsSchema = z.array(
  z.object({ repertoireId: z.uuid(), latest: z.number().int().nullable() }),
);

/** The version of each repertoire's latest change for players. */
async function latestChanges(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = latestRowsSchema.parse(
    await db
      .select({
        repertoireId: repertoireChanges.repertoireId,
        latest: max(repertoireChanges.version),
      })
      .from(repertoireChanges)
      .where(inArray(repertoireChanges.repertoireId, [...ids]))
      .groupBy(repertoireChanges.repertoireId),
  );
  return new Map(rows.map((row) => [row.repertoireId, row.latest ?? 0]));
}

/**
 * Each assignment the player may use (canUseAssignment) with its
 * repertoire, loaded through liveRepertoire.
 */
async function loadLive(
  tx: Executor,
  playerId: string,
): Promise<{ assignment: EffectiveAssignment; loaded: LoadedRepertoire }[]> {
  const live = [];
  for (const assignment of await usableAssignments(tx, playerId)) {
    const loaded = await loadRepertoireRows(
      tx,
      liveRepertoire(tx, playerId, assignment.repertoireId),
    );
    if (loaded !== undefined) live.push({ assignment, loaded });
  }
  return live;
}

interface ItemFacts {
  readonly assignment: EffectiveAssignment;
  readonly loaded: LoadedRepertoire;
  readonly coachName: string;
  readonly latest: number;
}

/** What the domain says of a live assignment at `now` (R-16, R-46, R-51, R-129, R-134). */
type LiveStatus = Pick<
  PlayerAssignment,
  'deadline' | 'paused' | 'done' | 'overdue'
>;

function statusOf(
  {
    assignment,
    loaded,
  }: { assignment: EffectiveAssignment; loaded: LoadedRepertoire },
  now: Date,
): LiveStatus {
  const deadline = effectiveDeadline(assignment.sources);
  const paused = !isTrainingActive(assignment.pausedAt);
  const done = allLearned(loaded.graph, NOTHING_LEARNED);
  const status = assignmentStatus(
    { deadline, done, paused, forked: false },
    now,
  );
  return { deadline, paused, done, overdue: status.overdue };
}

function itemOf(facts: ItemFacts, now: Date): PlayerAssignment {
  const { assignment, loaded } = facts;
  return {
    repertoireId: assignment.repertoireId,
    name: loaded.repertoire.name,
    side: loaded.repertoire.side,
    coachId: assignment.coachId,
    coachName: facts.coachName,
    updated: isUpdated(assignment, facts.latest),
    ...statusOf(facts, now),
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
            latest: latest.get(entry.assignment.repertoireId) ?? 0,
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
    .where(liveRepertoire(db, playerId, repertoireId));

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
  { assignment: EffectiveAssignment; loaded: LoadedRepertoire } | undefined
> {
  const assignment = await usableAssignment(tx, playerId, repertoireId);
  if (assignment === undefined) return undefined;
  const loaded = await loadRepertoireRows(
    tx,
    liveRepertoire(tx, playerId, repertoireId),
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

const changeRowsSchema = z.array(z.object({ changes: moveChangesSchema }));

/**
 * The net changes to the player's live assignment after the version they
 * last saw, never before the one assigned (seenFloor), up to and including
 * `upToVersion`, in version order; undefined unless it is theirs.
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
        .select({ changes: repertoireChanges.changes })
        .from(repertoireChanges)
        .where(
          and(
            inArray(
              repertoireChanges.repertoireId,
              liveId(tx, playerId, repertoireId),
            ),
            gt(repertoireChanges.version, seenFloor(assignment)),
            lte(repertoireChanges.version, upToVersion),
          ),
        )
        .orderBy(asc(repertoireChanges.version)),
    );
    return { changes: netMoveChanges(rows.map((row) => row.changes)) };
  }, SNAPSHOT);
}

const ownRowsSchema = z.array(z.object({ id: z.uuid() }));

/** The player's own repertoires, oldest first; always active. */
async function ownTraining(
  tx: Executor,
  playerId: string,
): Promise<TrainingRepertoire[]> {
  const own = ownRowsSchema.parse(
    await tx
      .select({ id: repertoires.id })
      .from(repertoires)
      .where(eq(repertoires.ownerAccountId, playerId))
      .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
  );
  const out: TrainingRepertoire[] = [];
  for (const { id } of own) {
    const loaded = await loadRepertoireRows(tx, ownedBy(id, playerId));
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
