/**
 * A Player's private notes on repertoire moves (R-21), keyed by move key
 * without a foreign key to the move row (decision 11): a removed move's
 * note stays and shows again if the move comes back.
 *
 * A player keeps notes on their own repertoires and on those assigned to
 * them live (not forked), and writes one only on a move the repertoire has.
 * Every function checks that on the same transaction or statement: the
 * domain decides (canKeepPersonalNotes or canUseAssignment, and
 * canWritePersonalNote) and the query enforces it again (CLAUDE.md,
 * decision 12).
 */
import {
  ASSIGNMENT_REFUSALS,
  canKeepPersonalNotes,
  canUseAssignment,
  canWritePersonalNote,
  REPERTOIRE_REFUSALS,
  type AssignmentHold,
  type AssignmentRefusal,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import { and, eq, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { liveRepertoire } from './assignments/access';
import { holdAssignment } from './assignments/player-state';
import type { Executor, Tx } from './client';
import { isUuid } from './ids';
import { ownedBy } from './repertoires/repository';
import { DONE, refusal } from './results';
import { personalNotes, repertoireMoves, repertoires } from './schema';

export interface PersonalNoteInput {
  readonly playerId: string;
  readonly repertoireId: string;
  readonly moveKey: string;
  /** Checked by the domain's personalNoteSchema; '' deletes the note. */
  readonly text: string;
  readonly now: Date;
}

type NoteAccess = Result<undefined, RepertoireAccessRefusal>;

const NOT_FOUND = refusal(REPERTOIRE_REFUSALS.notFound);

/** No assignment reaches the player: what an owner's own repertoire has. */
const NO_ASSIGNMENT: AssignmentHold = { assigned: false, forked: false };

/**
 * The repertoires `playerId` keeps notes on, as SQL: their own, or one an
 * assignment reaches them through live. canKeepPersonalNotes is the rule,
 * this filter enforces it again.
 */
const notesAllowedFor = (
  db: Executor,
  playerId: string,
  repertoireId: string,
): SQL | undefined =>
  or(
    ownedBy(repertoireId, playerId),
    liveRepertoire(db, playerId, repertoireId),
  );

const ownerRowsSchema = z.array(z.object({ ownerId: z.string() }));

/**
 * The repertoire's owner and the player's assignment of it, with what
 * keeps it there held until `tx` ends: their own repertoire's row (key
 * share), or the rows an assignment reaches them through (holdAssignment),
 * which a delete of the repertoire must wait for too.
 */
async function holdNotesAccess(
  tx: Tx,
  playerId: string,
  repertoireId: string,
): Promise<{ ownerId: string; hold: AssignmentHold } | undefined> {
  const [own] = ownerRowsSchema.parse(
    await tx
      .select({ ownerId: repertoires.ownerAccountId })
      .from(repertoires)
      .where(ownedBy(repertoireId, playerId))
      .for('key share'),
  );
  if (own !== undefined) return { ownerId: own.ownerId, hold: NO_ASSIGNMENT };
  const hold = await holdAssignment(tx, { playerId, repertoireId });
  const [row] = ownerRowsSchema.parse(
    await tx
      .select({ ownerId: repertoires.ownerAccountId })
      .from(repertoires)
      .where(eq(repertoires.id, repertoireId)),
  );
  return row === undefined ? undefined : { ownerId: row.ownerId, hold };
}

/** May `playerId` keep notes on repertoire `repertoireId`? */
async function mayKeepNotes(
  tx: Tx,
  playerId: string,
  repertoireId: string,
): Promise<NoteAccess> {
  if (!isUuid(repertoireId)) return NOT_FOUND;
  const held = await holdNotesAccess(tx, playerId, repertoireId);
  return held === undefined
    ? NOT_FOUND
    : canKeepPersonalNotes({ id: playerId }, held, held.hold);
}

const moveRowsSchema = z.array(z.object({ from: z.string(), san: z.string() }));

/**
 * May the note be written on its move? Read after mayKeepNotes, under the
 * holds it took, so the moves are those of a repertoire the player keeps
 * notes on; canWritePersonalNote decides.
 */
async function mayWriteOnMove(
  tx: Tx,
  note: PersonalNoteInput,
): Promise<NoteAccess> {
  const moves = moveRowsSchema.parse(
    await tx
      .select({ from: repertoireMoves.fromKey, san: repertoireMoves.san })
      .from(repertoireMoves)
      .where(eq(repertoireMoves.repertoireId, note.repertoireId)),
  );
  return canWritePersonalNote({ moves }, note.moveKey, note.text);
}

const notePk = (
  n: Pick<PersonalNoteInput, 'playerId' | 'repertoireId' | 'moveKey'>,
) =>
  and(
    eq(personalNotes.playerAccountId, n.playerId),
    eq(personalNotes.repertoireId, n.repertoireId),
    eq(personalNotes.moveKey, n.moveKey),
  );

async function writeNote(tx: Executor, note: PersonalNoteInput): Promise<void> {
  if (note.text === '') {
    await tx.delete(personalNotes).where(notePk(note));
    return;
  }
  await tx
    .insert(personalNotes)
    .values({
      playerAccountId: note.playerId,
      repertoireId: note.repertoireId,
      moveKey: note.moveKey,
      text: note.text,
      updatedAt: note.now,
    })
    .onConflictDoUpdate({
      target: [
        personalNotes.playerAccountId,
        personalNotes.repertoireId,
        personalNotes.moveKey,
      ],
      set: { text: note.text, updatedAt: note.now },
    });
}

/** Whether the player may keep notes on the repertoire, decided in `tx`. */
type NotesGate<R extends { readonly reason: string }> = (
  tx: Tx,
  note: PersonalNoteInput,
) => Promise<Result<undefined, R>>;

/**
 * Writes the note in one transaction with `gate`'s check and then
 * canWritePersonalNote's: a note set is on one of the repertoire's moves,
 * one removed on any key (decision 11).
 */
function writeChecked<R extends { readonly reason: string }>(
  db: Executor,
  note: PersonalNoteInput,
  gate: NotesGate<R>,
): Promise<Result<undefined, R | RepertoireAccessRefusal>> {
  return db.transaction(async (tx) => {
    const access = await gate(tx, note);
    if (!access.ok) return access;
    const onMove = await mayWriteOnMove(tx, note);
    if (!onMove.ok) return onMove;
    await writeNote(tx, note);
    return DONE;
  });
}

/**
 * Sets or removes one player's private note on a move (R-21) of a
 * repertoire of their own or assigned to them live; one missing, not
 * theirs and not assigned to them live, or a move it does not have, is
 * refused as not found.
 */
export function setPersonalNote(
  db: Executor,
  note: PersonalNoteInput,
): Promise<NoteAccess> {
  return writeChecked(db, note, (tx, n) =>
    mayKeepNotes(tx, n.playerId, n.repertoireId),
  );
}

const NOT_ASSIGNED = refusal(ASSIGNMENT_REFUSALS.notFound);

/**
 * Sets or removes one player's private note on a move (R-21) of a
 * repertoire only as assigned to them live: the assigned page's write.
 * Their own repertoire, one not assigned to them or forked is refused as
 * an assignment not found (canUseAssignment); a move it does not have, as
 * a repertoire not found.
 */
export function setAssignedPersonalNote(
  db: Executor,
  note: PersonalNoteInput,
): Promise<Result<undefined, AssignmentRefusal | RepertoireAccessRefusal>> {
  return writeChecked(db, note, async (tx, n) =>
    isUuid(n.repertoireId)
      ? canUseAssignment(await holdAssignment(tx, n))
      : NOT_ASSIGNED,
  );
}

const noteRowsSchema = z.array(
  z.object({ moveKey: z.string(), text: z.string() }),
);

/**
 * One player's notes on one repertoire, by move key; never anyone else's,
 * and none on a repertoire they may not keep notes on (the statement joins
 * the repertoire through the same access filter as setPersonalNote).
 */
export async function listPersonalNotes(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<Record<string, string>> {
  if (!isUuid(repertoireId)) return {};
  const rows = noteRowsSchema.parse(
    await db
      .select({ moveKey: personalNotes.moveKey, text: personalNotes.text })
      .from(personalNotes)
      .innerJoin(
        repertoires,
        and(
          eq(repertoires.id, personalNotes.repertoireId),
          notesAllowedFor(db, playerId, repertoireId),
        ),
      )
      .where(eq(personalNotes.playerAccountId, playerId)),
  );
  return Object.fromEntries(rows.map((r) => [r.moveKey, r.text]));
}
