'use client';

import type { JSX } from 'react';
import {
  CoachNotes,
  PersonalNote,
  type MoveCoachNote,
  type NoteOutcome,
} from '../../repertoire-view';

export interface OwnerNotesProps {
  /** The coaches' notes on the move, read-only (R-107). */
  readonly coachNotes: readonly MoveCoachNote[];
  /** The viewer's Personal note on the move; '' for none. */
  readonly note: string;
  readonly onSaveNote: (text: string) => Promise<NoteOutcome>;
}

/**
 * What the owner sees under a move's comment (docs/design/repertoire-screen.md):
 * the coaches' notes (read-only), then the owner's private note. Key it by
 * the move, so the note's field starts afresh on each move.
 */
export function OwnerNotes({
  coachNotes,
  note,
  onSaveNote,
}: OwnerNotesProps): JSX.Element {
  return (
    <>
      <CoachNotes notes={coachNotes} />
      <PersonalNote initial={note} onSaveNote={onSaveNote} />
    </>
  );
}
