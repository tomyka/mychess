/**
 * A Player's private notes on repertoire moves (R-21), keyed by move key
 * without a foreign key to the move row (decision 11): a removed move's
 * note stays and shows again if the move comes back.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './client';
import { personalNotes } from './schema';

export interface PersonalNoteInput {
  readonly playerId: string;
  readonly repertoireId: string;
  readonly moveKey: string;
  /** Checked by the domain's personalNoteSchema; '' deletes the note. */
  readonly text: string;
  readonly now: Date;
}

const notePk = (
  n: Pick<PersonalNoteInput, 'playerId' | 'repertoireId' | 'moveKey'>,
) =>
  and(
    eq(personalNotes.playerAccountId, n.playerId),
    eq(personalNotes.repertoireId, n.repertoireId),
    eq(personalNotes.moveKey, n.moveKey),
  );

/** Sets or removes one player's private note on a move (R-21). The caller checked access. */
export async function setPersonalNote(
  db: Executor,
  note: PersonalNoteInput,
): Promise<void> {
  if (note.text === '') {
    await db.delete(personalNotes).where(notePk(note));
    return;
  }
  await db
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

const noteRowsSchema = z.array(
  z.object({ moveKey: z.string(), text: z.string() }),
);

/** One player's notes on one repertoire, by move key; never anyone else's. */
export async function listPersonalNotes(
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
          eq(personalNotes.repertoireId, repertoireId),
        ),
      ),
  );
  return Object.fromEntries(rows.map((r) => [r.moveKey, r.text]));
}
