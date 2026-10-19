'use client';

// The viewer's Personal notes on the repertoire page (R-21).
import { useState } from 'react';
import { savePersonalNoteAction, type NoteOutcome } from './actions';
import { withNote } from './notes-by-move';

/** The viewer's notes, and a saver for the note on one move. */
export interface Notes {
  readonly notes: Readonly<Record<string, string>>;
  readonly save: (moveKey: string) => (text: string) => Promise<NoteOutcome>;
}

/** The viewer's Personal notes, saved through the action (R-21). */
export function useNotes(
  repertoireId: string,
  initial: Readonly<Record<string, string>>,
): Notes {
  const [notes, setNotes] = useState(initial);
  return {
    notes,
    save:
      (moveKey: string) =>
      async (text: string): Promise<NoteOutcome> => {
        const outcome = await savePersonalNoteAction({
          repertoireId,
          moveKey,
          text,
        });
        if (outcome.ok) setNotes((now) => withNote(now, moveKey, text.trim()));
        return outcome;
      },
  };
}
