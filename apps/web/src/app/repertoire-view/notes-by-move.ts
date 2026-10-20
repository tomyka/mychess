'use client';

// Notes kept by move key, as the repertoire screens hold them in state: the
// viewer's Personal notes on the owner's page, the coach's own notes on a
// shared repertoire.
import { useState } from 'react';

/** `notes` with the note on `key` set, or removed when `text` is empty. */
function withNote(
  notes: Readonly<Record<string, string>>,
  key: string,
  text: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(notes).filter(([k]) => k !== key),
  );
  return text === '' ? next : { ...next, [key]: text };
}

/** Notes by move key, and a setter for one move's (empty removes it). */
export interface NotesByMove {
  readonly byMove: Readonly<Record<string, string>>;
  readonly set: (key: string, text: string) => void;
}

/** Notes by move key, starting from `initial` and kept as `set` changes them. */
export function useNotesByMove(
  initial: Readonly<Record<string, string>>,
): NotesByMove {
  const [byMove, setByMove] = useState(initial);
  return {
    byMove,
    set(key, text) {
      setByMove((now) => withNote(now, key, text));
    },
  };
}
