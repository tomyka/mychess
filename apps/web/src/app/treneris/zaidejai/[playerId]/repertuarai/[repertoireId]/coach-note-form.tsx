'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type JSX } from 'react';
import type { CoachNoteMove } from '../../../../../../server/coach-input';
import { SECONDARY_BUTTON } from '../../../../../buttons';
import { StatusLine } from '../../../../../status-line';
import {
  deleteCoachNoteAction,
  saveCoachNoteAction,
  type CoachNoteState,
} from '../../../../actions';
import { PANEL_LABEL } from '../../../../../repertuarai/[id]/panel-styles';

export interface CoachNoteFormProps {
  /** The player's repertoire and the move the note is on. */
  readonly target: CoachNoteMove;
  /** Who else sees the note: the player (R-107). */
  readonly playerName: string;
  /** The coach's note on the move; '' for none. */
  readonly initial: string;
  /** Told the note's text once saved, '' once deleted. */
  readonly onChange: (text: string) => void;
}

/** What the last save or delete came to: done, or a catalogue key. */
type Status =
  | 'idle'
  | 'saved'
  | 'deleted'
  | 'repertoires.failed'
  | NonNullable<CoachNoteState['refusal']>;

/** The note's text and what saving and deleting it does. */
function useCoachNote({ target, initial, onChange }: CoachNoteFormProps) {
  const [text, setText] = useState(initial);
  const [stored, setStored] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');
  const [pending, startTransition] = useTransition();
  const run = (
    work: () => Promise<CoachNoteState>,
    next: string,
    done: Status,
  ): void => {
    startTransition(async () => {
      try {
        const outcome = await work();
        if (outcome.refusal !== undefined) {
          setStatus(outcome.refusal);
          return;
        }
        setText(next);
        setStored(next);
        setStatus(done);
        onChange(next);
      } catch {
        setStatus('repertoires.failed');
      }
    });
  };
  return {
    text,
    setText,
    stored,
    status,
    pending,
    save: () => {
      run(() => saveCoachNoteAction({ ...target, text }), text.trim(), 'saved');
    },
    remove: () => {
      run(() => deleteCoachNoteAction(target), '', 'deleted');
    },
  };
}

/** What the status line says for `status`. */
function useStatusText(status: Status): string | null {
  const t = useTranslations();
  if (status === 'idle') return null;
  if (status === 'saved') return t('coach.shared.noteSaved');
  if (status === 'deleted') return t('coach.shared.noteDeleted');
  return t(status);
}

/** Save, and Delete once there is a note. */
function NoteButtons({
  note,
}: {
  readonly note: ReturnType<typeof useCoachNote>;
}): JSX.Element {
  const t = useTranslations('coach.shared');
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={note.pending}
        onClick={note.save}
        className={SECONDARY_BUTTON}
      >
        {t('saveNote')}
      </button>
      {note.stored === '' ? null : (
        <button
          type="button"
          disabled={note.pending}
          onClick={note.remove}
          className={`${SECONDARY_BUTTON} text-error`}
        >
          {t('deleteNote')}
        </button>
      )}
    </div>
  );
}

/**
 * The coach's own note on the current move of a shared repertoire (R-42):
 * a field, Save and, once there is a note, Delete. The player sees it too
 * (R-107); other coaches do not (R-125).
 */
export function CoachNoteForm(props: CoachNoteFormProps): JSX.Element {
  const t = useTranslations('coach.shared');
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const note = useCoachNote(props);
  const said = useStatusText(note.status);
  const done = note.status === 'saved' || note.status === 'deleted';
  const refused = note.status !== 'idle' && !done;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-2">
        <label htmlFor={fieldId} className={PANEL_LABEL}>
          {t('note')}
        </label>
        <span id={hintId} className="text-sm text-fg-muted">
          {t('noteHint', { name: props.playerName })}
        </span>
      </div>
      <textarea
        id={fieldId}
        rows={3}
        value={note.text}
        onChange={(event) => {
          note.setText(event.target.value);
        }}
        aria-describedby={refused ? `${hintId} ${statusId}` : hintId}
        aria-invalid={refused ? true : undefined}
        className="rounded-control border border-border-strong bg-surface p-3 text-base text-fg aria-invalid:border-error"
      />
      <NoteButtons note={note} />
      <StatusLine
        id={statusId}
        text={said}
        tone={refused ? 'error' : 'success'}
      />
    </div>
  );
}
