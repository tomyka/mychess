'use client';

// The viewer's Personal notes on a repertoire view (R-21).
import { useNotesByMove } from './notes-by-move';
import type { NoteOutcome } from './personal-note';

/** The viewer's notes by move key, and a saver for the note on one move. */
export interface Notes {
  readonly byMove: Readonly<Record<string, string>>;
  readonly save: (moveKey: string) => (text: string) => Promise<NoteOutcome>;
}

/** Saves the note on a move through the view's own action. */
type SaveNote = (moveKey: string, text: string) => Promise<NoteOutcome>;

/** The viewer's Personal notes, kept current as `saveNote` saves them. */
export function useNotes(
  initial: Readonly<Record<string, string>>,
  saveNote: SaveNote,
): Notes {
  const notes = useNotesByMove(initial);
  return {
    byMove: notes.byMove,
    save:
      (moveKey: string) =>
      async (text: string): Promise<NoteOutcome> => {
        const outcome = await saveNote(moveKey, text);
        if (outcome.ok) notes.set(moveKey, text.trim());
        return outcome;
      },
  };
}
