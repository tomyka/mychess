/**
 * Coach notes on a player's repertoire shared with the coach (R-42). A note
 * lives only under its share (R-124): the coach_notes_share_fk cascade
 * deletes it on unshare, unlink or delete. The coach sees only their own
 * notes, the owner every coach's (R-125). Nothing here reads personal_notes.
 */
import { parseMoveKey } from '@mychess/chess';
import {
  canWriteCoachNote,
  type AccessRefusal,
  type CoachAccessFacts,
  type CoachNoteRefusal,
  type CoachNoteTarget,
  type Result,
} from '@mychess/domain';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from './client';
import { holdLink } from './coach-queries';
import { isUuid } from './ids';
import { DONE } from './results';
import { accounts, coachNotes, repertoireMoves, repertoires } from './schema';
import { holdRepertoireOwner, sharedIds } from './share-scope';

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

export interface CoachNoteInput extends CoachNoteTarget {
  readonly moveKey: string;
  /** Checked by the domain's coachNoteSchema. */
  readonly text: string;
  readonly now: Date;
}

/**
 * The access facts for writing on `note.repertoireId`, holding what they
 * rest on until `tx` ends, in the order an unlink takes them (link, then
 * shares): the link (key share), the repertoire (key share, as a delete
 * takes it before its shares) and the share (share), so an unshare,
 * unlink or delete waits for the note rather than leaving it behind.
 */
async function holdNoteFacts(
  tx: Tx,
  note: CoachNoteTarget,
): Promise<CoachAccessFacts> {
  const linked = await holdLink(tx, note.coachId, note.playerId);
  if (
    !linked ||
    (await holdRepertoireOwner(tx, note.repertoireId)) === undefined
  )
    return { linked, sharedRepertoireIds: new Set() };
  return {
    linked,
    sharedRepertoireIds: await sharedIds(tx, note.coachId, note.playerId, {
      repertoireId: note.repertoireId,
      hold: true,
    }),
  };
}

/** Does repertoire `repertoireId` have the move `key` names? */
async function hasMove(
  tx: Tx,
  repertoireId: string,
  key: string,
): Promise<boolean> {
  const parts = parseMoveKey(key);
  if (parts === null) return false;
  const rows = idRowsSchema.parse(
    await tx
      .select({ id: repertoireMoves.id })
      .from(repertoireMoves)
      .where(
        and(
          eq(repertoireMoves.repertoireId, repertoireId),
          eq(repertoireMoves.fromKey, parts.fromKey),
          eq(repertoireMoves.san, parts.san),
        ),
      ),
  );
  return rows.length === 1;
}

/**
 * Writes or replaces the coach's note on a move of a repertoire shared with
 * them (R-42), in one transaction with the facts it is decided on.
 */
export async function upsertCoachNote(
  db: Executor,
  note: CoachNoteInput,
): Promise<Result<undefined, AccessRefusal | CoachNoteRefusal>> {
  return db.transaction(async (tx) => {
    const facts = await holdNoteFacts(tx, note);
    const moveExists =
      facts.sharedRepertoireIds.size > 0 &&
      (await hasMove(tx, note.repertoireId, note.moveKey));
    const check = canWriteCoachNote(note, facts, moveExists);
    if (!check.ok) return check;
    await tx
      .insert(coachNotes)
      .values({
        coachId: note.coachId,
        repertoireId: note.repertoireId,
        moveKey: note.moveKey,
        text: note.text,
        createdAt: note.now,
        updatedAt: note.now,
      })
      .onConflictDoUpdate({
        target: [
          coachNotes.coachId,
          coachNotes.repertoireId,
          coachNotes.moveKey,
        ],
        set: { text: note.text, updatedAt: note.now },
      });
    return DONE;
  });
}

/**
 * Removes the coach's own note on a move; anyone else's is untouched. Once
 * the share has ended there is none left to remove (R-124).
 */
export async function deleteCoachNote(
  db: Executor,
  note: Pick<CoachNoteInput, 'coachId' | 'repertoireId' | 'moveKey'>,
): Promise<void> {
  if (!isUuid(note.repertoireId)) return;
  await db
    .delete(coachNotes)
    .where(
      and(
        eq(coachNotes.coachId, note.coachId),
        eq(coachNotes.repertoireId, note.repertoireId),
        eq(coachNotes.moveKey, note.moveKey),
      ),
    );
}

/** A Coach note as a view shows it: on a move, with its coach's display name. */
export interface CoachNote {
  readonly coachId: string;
  readonly coachName: string;
  readonly moveKey: string;
  readonly text: string;
  readonly updatedAt: Date;
}

const noteRowsSchema = z.array(
  z.object({
    coachId: z.string().min(1),
    coachName: z.string(),
    moveKey: z.string(),
    text: z.string(),
    updatedAt: z.date(),
  }),
);

/** The notes on repertoire `repertoireId` where `where` holds, by move then coach. */
async function notesWhere(
  db: Executor,
  repertoireId: string,
  where: SQL | undefined,
): Promise<CoachNote[]> {
  return noteRowsSchema.parse(
    await db
      .select({
        coachId: coachNotes.coachId,
        coachName: accounts.displayName,
        moveKey: coachNotes.moveKey,
        text: coachNotes.text,
        updatedAt: coachNotes.updatedAt,
      })
      .from(coachNotes)
      .innerJoin(accounts, eq(accounts.id, coachNotes.coachId))
      .innerJoin(repertoires, eq(repertoires.id, coachNotes.repertoireId))
      .where(and(eq(coachNotes.repertoireId, repertoireId), where))
      .orderBy(
        asc(coachNotes.moveKey),
        asc(accounts.displayName),
        asc(coachNotes.coachId),
      ),
  );
}

/**
 * The coach notes on the owner's repertoire, with each coach's name, for
 * the owner's read-only view (R-107, R-125); none on anyone else's
 * repertoire. Only live shares have notes (R-124).
 */
export async function coachNotesOn(
  db: Executor,
  ownerId: string,
  repertoireId: string,
): Promise<CoachNote[]> {
  if (!isUuid(repertoireId)) return [];
  return notesWhere(db, repertoireId, eq(repertoires.ownerAccountId, ownerId));
}

/** The coach's own notes on a repertoire shared with them (R-125); run inside the share's read. */
export function coachOwnNotes(
  tx: Executor,
  coachId: string,
  repertoireId: string,
): Promise<CoachNote[]> {
  return notesWhere(tx, repertoireId, eq(coachNotes.coachId, coachId));
}

const writtenRowsSchema = z.array(
  z.object({
    moveKey: z.string(),
    text: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
);

/** The notes the coach wrote (for the data export, R-106), oldest first. */
export async function notesWrittenBy(
  db: Executor,
  coachId: string,
): Promise<z.infer<typeof writtenRowsSchema>> {
  return writtenRowsSchema.parse(
    await db
      .select({
        moveKey: coachNotes.moveKey,
        text: coachNotes.text,
        createdAt: coachNotes.createdAt,
        updatedAt: coachNotes.updatedAt,
      })
      .from(coachNotes)
      .where(eq(coachNotes.coachId, coachId))
      .orderBy(asc(coachNotes.createdAt), asc(coachNotes.id)),
  );
}
