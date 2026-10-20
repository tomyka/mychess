/**
 * A Player's private notes on repertoire moves (R-21), keyed by move key
 * without a foreign key to the move row (decision 11): a removed move's
 * note stays and shows again if the move comes back.
 *
 * A player keeps notes on their own repertoires and on those assigned to
 * them live (not forked). Both functions check that on the same
 * transaction or statement: the domain decides (canKeepPersonalNotes) and
 * the query enforces it again (CLAUDE.md, decision 12).
 */
import {
  canKeepPersonalNotes,
  REPERTOIRE_REFUSALS,
  type AssignmentHold,
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
import { personalNotes, repertoires } from './schema';

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

/**
 * Sets or removes one player's private note on a move (R-21), in one
 * transaction with the check that the player may keep notes on the
 * repertoire; one missing, not theirs and not assigned to them live is
 * refused as not found.
 */
export async function setPersonalNote(
  db: Executor,
  note: PersonalNoteInput,
): Promise<NoteAccess> {
  return db.transaction(async (tx) => {
    const access = await mayKeepNotes(tx, note.playerId, note.repertoireId);
    if (!access.ok) return access;
    await writeNote(tx, note);
    return DONE;
  });
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
