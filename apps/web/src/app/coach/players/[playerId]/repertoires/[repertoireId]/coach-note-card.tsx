'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../../../../../buttons';
import { PANEL_LABEL } from '../../../../../repertoire-view';
import {
  CoachNoteFields,
  CoachNoteStatus,
  DeleteNoteButton,
  useCoachNote,
  useNoteWords,
  type CoachNote,
  type CoachNoteOnMoveProps,
} from './coach-note-form';

/** The note as read: its text, then Edit and Delete, or Add a note. */
function NoteAsRead({
  note,
  empty,
  onEdit,
}: {
  readonly note: CoachNote;
  readonly empty: boolean;
  readonly onEdit: () => void;
}): JSX.Element {
  const t = useTranslations('coach.shared');
  return (
    <>
      {empty ? null : (
        <p className="break-words whitespace-pre-line">{note.note}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className={SECONDARY_BUTTON}>
          {empty ? t('addNote') : t('editNote')}
        </button>
        <DeleteNoteButton note={note} />
      </div>
      <CoachNoteStatus note={note} />
    </>
  );
}

/**
 * The coach's own note on the current move on a desktop (`lg` up, where
 * the frame is two columns; docs/design/coach-shared-repertoire.md,
 * Coach's view): a card under the move's comment, headed by the move and
 * who sees it. Edit (or Add a note) turns it into the field with Save and
 * Cancel, in place. Below `lg` the one-line strip stands in for it
 * (CoachNoteStrip).
 */
export function CoachNoteCard(props: CoachNoteOnMoveProps): JSX.Element {
  const t = useTranslations('coach.shared');
  const headingId = useId();
  const words = useNoteWords(props);
  const [editing, setEditing] = useState(false);
  const note = useCoachNote({
    ...props,
    onDone: () => {
      setEditing(false);
    },
  });
  return (
    <section
      aria-labelledby={headingId}
      className="hidden space-y-2 rounded-card border border-border p-3 not-first:mt-2 lg:block"
    >
      <h2 id={headingId} className={PANEL_LABEL}>
        {words.label}
      </h2>
      {editing ? (
        <CoachNoteFields note={note} labelledBy={headingId}>
          <button
            type="button"
            onClick={() => {
              note.reset();
              setEditing(false);
            }}
            className={SECONDARY_BUTTON}
          >
            {t('cancel')}
          </button>
        </CoachNoteFields>
      ) : (
        <NoteAsRead
          note={note}
          empty={words.empty}
          onEdit={() => {
            note.reset();
            setEditing(true);
          }}
        />
      )}
    </section>
  );
}
