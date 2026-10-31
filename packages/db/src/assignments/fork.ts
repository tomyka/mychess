/**
 * Forks (R-20, R-43, R-47, R-128; plan decision 7): a player's own copy of
 * a repertoire they had by assignment. The copy has the same chapters and
 * moves; the coach's comments become read-only fork coach notes with the
 * coach's display name, the copy's own comments start empty, and the
 * player's personal notes (never another player's) come along. Reviews are
 * the player's, keyed by move, so nothing about them is copied (R-53).
 * A fork is a repertoire like any other, so the player's R-162 limits
 * refuse one they ask for; only the automatic fork of a deleting coach is
 * made past them (R-163).
 */
import { moveKey, type RepertoireGraph, type Side } from '@mychess/chess';
import {
  ownScope,
  ASSIGNMENT_REFUSALS,
  canFork,
  ok,
  refuse,
  type AssignmentRefusal,
  type RepertoireLimitRefusal,
  type Result,
} from '@mychess/domain';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { lockAccountById } from '../accounts';
import { assignmentPlayers, forkCoachNotes } from '../assignment-schema';
import type { Executor, Tx } from '../client';
import { isUuid } from '../ids';
import {
  createRepertoire,
  createRepertoireBeyondLimits,
} from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { batches } from '../repertoires/write';
import { personalNotes, repertoires } from '../schema';
import { holdAssignment } from './reach';
import { takeSnapshot, type Snapshot } from './snapshot';

/** What a fork is made of: a live repertoire's snapshot, or an offer's. */
export interface ForkSource extends Snapshot {
  /** The player the fork is for; it becomes the owner. */
  readonly playerId: string;
  readonly name: string;
  readonly side: Side;
  /** The display name the coach notes carry (R-47, R-49). */
  readonly coachName: string;
  readonly now: Date;
  /** The automatic fork of a deleting coach, made past the limits (R-163). */
  readonly beyondLimits?: true;
}

const uncommented = (graph: RepertoireGraph): RepertoireGraph => ({
  ...graph,
  moves: graph.moves.map((move) => ({ ...move, comment: null })),
});

/** The coach's comments of `graph`, by move key. */
const commentsOf = (graph: RepertoireGraph) =>
  graph.moves.flatMap((move) =>
    move.comment === null
      ? []
      : [{ moveKey: moveKey(move.from, move.san), text: move.comment }],
  );

/**
 * Writes the fork of `source` for its player and returns its id, or the
 * player's R-162 limit refusal with nothing written. On a transaction it
 * nests as a savepoint. Package-internal.
 */
export async function writeFork(
  tx: Executor,
  source: ForkSource,
): Promise<Result<string, RepertoireLimitRefusal>> {
  const create =
    source.beyondLimits === true
      ? createRepertoireBeyondLimits
      : createRepertoire;
  const created = await create(tx, {
    ownerId: source.playerId,
    side: source.side,
    name: source.name,
    graph: uncommented(source.graph),
    now: source.now,
  });
  if (!created.ok) return created;
  const forkId = created.value;
  for (const batch of batches(commentsOf(source.graph)))
    await tx.insert(forkCoachNotes).values(
      batch.map((note) => ({
        ...note,
        repertoireId: forkId,
        coachName: source.coachName,
      })),
    );
  for (const batch of batches(source.personalNotes))
    await tx.insert(personalNotes).values(
      batch.map((note) => ({
        ...note,
        playerAccountId: source.playerId,
        repertoireId: forkId,
        updatedAt: source.now,
      })),
    );
  return ok(forkId);
}

/** The player and the repertoire they fork; `playerId` is the session account. */
export interface ForkRequest {
  readonly playerId: string;
  readonly repertoireId: string;
}

type ForkResult = Result<
  { forkId: string },
  AssignmentRefusal | RepertoireLimitRefusal
>;

const NOT_FOUND = refuse(ASSIGNMENT_REFUSALS.notFound);

const ownerRowsSchema = z.array(z.object({ ownerId: z.string().min(1) }));

async function ownerOf(
  tx: Tx,
  repertoireId: string,
  lock?: 'share',
): Promise<string | undefined> {
  const select = tx
    .select({ ownerId: repertoires.ownerAccountId })
    .from(repertoires)
    .where(eq(repertoires.id, repertoireId));
  const [row] = ownerRowsSchema.parse(
    await (lock === undefined ? select : select.for(lock)),
  );
  return row?.ownerId;
}

/**
 * The repertoire's coach, with their account row locked first (the S4 lock
 * order), so the fork serialises with every change of that coach's
 * assignments (changeAssignments); then the repertoire row held FOR SHARE,
 * so no edit or delete runs while it is copied.
 */
async function lockCoach(
  tx: Tx,
  repertoireId: string,
): Promise<{ displayName: string } | undefined> {
  const ownerId = await ownerOf(tx, repertoireId);
  if (ownerId === undefined) return undefined;
  const coach = await lockAccountById(tx, ownerId);
  const held = await ownerOf(tx, repertoireId, 'share');
  return held === ownerId ? coach : undefined;
}

/** Marks the assignment forked for the player (R-128). */
async function markForked(tx: Tx, req: ForkRequest, now: Date): Promise<void> {
  await tx
    .insert(assignmentPlayers)
    .values({ ...req, forkedAt: now })
    .onConflictDoUpdate({
      target: [assignmentPlayers.playerId, assignmentPlayers.repertoireId],
      set: { forkedAt: now },
    });
}

/**
 * Forks the player's own live assignment of the repertoire (canFork): a
 * repertoire not assigned to them now, or already forked, is not found,
 * and at the player's R-162 limits the fork is refused; either way nothing
 * is written and the assignment stays unforked. On a transaction it nests
 * as a savepoint.
 */
export function forkAssignment(
  db: Executor,
  req: ForkRequest,
  now: Date,
): Promise<ForkResult> {
  return fork(db, req, now, {});
}

/**
 * The automatic fork of a deleting coach (R-49): forkAssignment, made past
 * the player's R-162 limits (R-163). Package-internal.
 */
export function autoForkAssignment(
  db: Executor,
  req: ForkRequest,
  now: Date,
): Promise<ForkResult> {
  return fork(db, req, now, { beyondLimits: true });
}

function fork(
  db: Executor,
  req: ForkRequest,
  now: Date,
  limits: Pick<ForkSource, 'beyondLimits'>,
): Promise<ForkResult> {
  if (!isUuid(req.repertoireId)) return Promise.resolve(NOT_FOUND);
  return db.transaction(async (tx) => {
    const coach = await lockCoach(tx, req.repertoireId);
    const allowed = canFork(await holdAssignment(tx, req));
    if (!allowed.ok) return allowed;
    const taken = await takeSnapshot(tx, req.playerId, req.repertoireId);
    if (coach === undefined || taken === undefined) return NOT_FOUND;
    const written = await writeFork(tx, {
      ...taken.snapshot,
      ...limits,
      playerId: req.playerId,
      name: taken.repertoire.name,
      side: taken.repertoire.side,
      coachName: coach.displayName,
      now,
    });
    if (!written.ok) return written;
    await markForked(tx, req, now);
    return ok({ forkId: written.value });
  });
}

/** A coach's comment kept read-only in a fork (R-47). */
export interface ForkCoachNote {
  readonly moveKey: string;
  readonly text: string;
  readonly coachName: string;
}

const noteRowsSchema = z.array(
  z.object({
    moveKey: z.string().min(1),
    text: z.string(),
    coachName: z.string(),
  }),
);

/**
 * The coach notes kept in fork `forkId`, by move key; none unless
 * `playerId` owns it (the statement filters by owner).
 */
export async function forkCoachNotesOn(
  db: Executor,
  playerId: string,
  forkId: string,
): Promise<ForkCoachNote[]> {
  if (!isUuid(forkId)) return [];
  return noteRowsSchema.parse(
    await db
      .select({
        moveKey: forkCoachNotes.moveKey,
        text: forkCoachNotes.text,
        coachName: forkCoachNotes.coachName,
      })
      .from(forkCoachNotes)
      .innerJoin(
        repertoires,
        and(
          eq(repertoires.id, forkCoachNotes.repertoireId),
          repertoireScope(db, ownScope(playerId), 'view'),
        ),
      )
      .where(eq(forkCoachNotes.repertoireId, forkId))
      .orderBy(asc(forkCoachNotes.moveKey)),
  );
}

/** A fork coach note with the name of the fork it is kept in. */
export interface PlayerForkCoachNote extends ForkCoachNote {
  readonly repertoire: string;
}

const playerNoteRowsSchema = z.array(
  z.object({
    repertoire: z.string(),
    moveKey: z.string().min(1),
    text: z.string(),
    coachName: z.string(),
  }),
);

/**
 * The coach notes kept in every fork `playerId` owns (R-141), by fork
 * (oldest first), then move key; the statement filters by owner.
 */
export async function forkCoachNotesOf(
  db: Executor,
  playerId: string,
): Promise<PlayerForkCoachNote[]> {
  return playerNoteRowsSchema.parse(
    await db
      .select({
        repertoire: repertoires.name,
        moveKey: forkCoachNotes.moveKey,
        text: forkCoachNotes.text,
        coachName: forkCoachNotes.coachName,
      })
      .from(forkCoachNotes)
      .innerJoin(repertoires, eq(repertoires.id, forkCoachNotes.repertoireId))
      .where(repertoireScope(db, ownScope(playerId), 'view'))
      .orderBy(
        asc(repertoires.createdAt),
        asc(repertoires.id),
        asc(forkCoachNotes.moveKey),
      ),
  );
}
