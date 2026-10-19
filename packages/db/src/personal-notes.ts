/**
 * A Player's private notes on repertoire moves (R-21), keyed by move key
 * without a foreign key to the move row (decision 11): a removed move's
 * note stays and shows again if the move comes back.
 *
 * Both functions check, on the same transaction or statement, that the
 * player may view the repertoire: the domain decides (canViewRepertoire)
 * and the query enforces it again (CLAUDE.md, decision 12).
 */
import {
  canViewRepertoire,
  REPERTOIRE_REFUSALS,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './client';
import { isUuid } from './ids';
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

/**
 * The repertoires `playerId` may view, as SQL. S3: their own (R-39);
 * canViewRepertoire is the rule, this filter enforces it again.
 */
const viewableBy = (playerId: string, repertoireId: string) =>
  and(
    eq(repertoires.id, repertoireId),
    eq(repertoires.ownerAccountId, playerId),
  );

const ownerRowsSchema = z.array(z.object({ ownerId: z.string() }));

/**
 * May `playerId` view repertoire `repertoireId`? Holds the repertoire row
 * (key share) until `tx` ends, so it is not deleted under the note.
 */
async function mayView(
  tx: Executor,
  playerId: string,
  repertoireId: string,
): Promise<NoteAccess> {
  if (!isUuid(repertoireId)) return NOT_FOUND;
  const [row] = ownerRowsSchema.parse(
    await tx
      .select({ ownerId: repertoires.ownerAccountId })
      .from(repertoires)
      .where(viewableBy(playerId, repertoireId))
      .for('key share'),
  );
  return row === undefined
    ? NOT_FOUND
    : canViewRepertoire({ id: playerId }, row);
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
 * transaction with the check that the player may view the repertoire; a
 * repertoire missing or not theirs to view is refused as not found.
 */
export async function setPersonalNote(
  db: Executor,
  note: PersonalNoteInput,
): Promise<NoteAccess> {
  return db.transaction(async (tx) => {
    const access = await mayView(tx, note.playerId, note.repertoireId);
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
 * and none on a repertoire the player may not view (the statement joins
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
          viewableBy(playerId, repertoireId),
        ),
      )
      .where(eq(personalNotes.playerAccountId, playerId)),
  );
  return Object.fromEntries(rows.map((r) => [r.moveKey, r.text]));
}
