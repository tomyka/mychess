'use client';

import { useTranslations } from 'next-intl';
import {
  useId,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';
import type { CoachNoteMove } from '../../../../../../server/coach-input';
import { DANGER_OUTLINE_BUTTON, PRIMARY_BUTTON } from '../../../../../buttons';
import { StatusLine } from '../../../../../status-line';
import {
  deleteCoachNoteAction,
  saveCoachNoteAction,
  type CoachNoteState,
} from '../../../../actions';

export interface CoachNoteProps {
  /** The player's repertoire and the move the note is on. */
  readonly target: CoachNoteMove;
  /** The coach's note on the move as saved; '' for none. */
  readonly note: string;
  /** Told the note's text once saved, '' once deleted. */
  readonly onChange: (text: string) => void;
}

/** The note on a move as the card and the strip show it. */
export interface CoachNoteOnMoveProps extends CoachNoteProps {
  /** The move it is on, as the move list writes it ("5... Qc7"). */
  readonly move: string;
  /** Who else sees the note: the player (R-107). */
  readonly playerName: string;
}

/** Whether there is no note on the move. */
const noNote = (note: string): boolean => note === '';

/**
 * What the card and the strip say of the note: its label, "My coach note
 * on 5... Qc7 · you and Gabija see this" (who sees it, so the coach never
 * thinks it private, R-107), and whether there is a note yet.
 */
export function useNoteWords({
  note,
  move,
  playerName,
}: CoachNoteOnMoveProps): { readonly label: string; readonly empty: boolean } {
  const t = useTranslations('coach.shared');
  return {
    label: t('noteOn', { move, name: playerName }),
    empty: noNote(note),
  };
}

/** A save or a delete that went through. */
export type NoteDone = 'saved' | 'deleted';

/** What the last save or delete came to: done, or a catalogue key. */
type Status =
  | 'idle'
  | NoteDone
  | 'repertoires.failed'
  | NonNullable<CoachNoteState['refusal']>;

/** The coach's note on one move, as `useCoachNote` keeps it. */
export interface CoachNote {
  /** As saved: '' for none. */
  readonly note: string;
  /** The field's text. */
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly status: Status;
  readonly pending: boolean;
  /** The field afresh: the saved note, nothing said. */
  readonly reset: () => void;
  readonly save: () => void;
  readonly remove: () => void;
}

/**
 * The coach's note on one move while it is being edited: the field's text,
 * what the last save or delete came to, and both. The saved note is the
 * view's (`note`), so the card and the phone strip never disagree; a
 * success tells the view, then `onDone` what it was (the card leaves the
 * field; the sheet closes and the strip says it).
 */
export function useCoachNote({
  target,
  note,
  onChange,
  onDone,
}: CoachNoteProps & {
  readonly onDone: (done: NoteDone) => void;
}): CoachNote {
  const [text, setText] = useState(note);
  const [status, setStatus] = useState<Status>('idle');
  const [pending, startTransition] = useTransition();
  const run = (
    work: () => Promise<CoachNoteState>,
    next: string,
    done: NoteDone,
  ): void => {
    startTransition(async () => {
      try {
        const outcome = await work();
        if (outcome.refusal !== undefined) {
          setStatus(outcome.refusal);
          return;
        }
        setText(next);
        setStatus(done);
        onChange(next);
        onDone(done);
      } catch {
        setStatus('repertoires.failed');
      }
    });
  };
  return {
    note,
    text,
    setText,
    status,
    pending,
    reset: () => {
      setText(note);
      setStatus('idle');
    },
    save: () => {
      run(() => saveCoachNoteAction({ ...target, text }), text.trim(), 'saved');
    },
    remove: () => {
      run(() => deleteCoachNoteAction(target), '', 'deleted');
    },
  };
}

/** Whether the last save or delete was refused or failed. */
const refused = (status: Status): boolean =>
  status !== 'idle' && status !== 'saved' && status !== 'deleted';

/** What a save or delete that went through is said as. */
export function useDoneText(): (done: NoteDone) => string {
  const t = useTranslations('coach.shared');
  return (done) => (done === 'saved' ? t('noteSaved') : t('noteDeleted'));
}

/** What the status line says for `status`. */
function useStatusText(status: Status): string | null {
  const t = useTranslations();
  const doneText = useDoneText();
  if (status === 'idle') return null;
  if (status === 'saved' || status === 'deleted') return doneText(status);
  return t(status);
}

/** The note's status line: saved, deleted, or why not. */
export function CoachNoteStatus({
  note,
  id,
}: {
  readonly note: CoachNote;
  readonly id?: string;
}): JSX.Element {
  const said = useStatusText(note.status);
  return (
    <StatusLine
      {...(id === undefined ? {} : { id })}
      text={said}
      tone={refused(note.status) ? 'error' : 'success'}
    />
  );
}

/** Delete, in the error tone, once there is a note. */
export function DeleteNoteButton({
  note,
}: {
  readonly note: CoachNote;
}): JSX.Element | null {
  const t = useTranslations('coach.shared');
  if (noNote(note.note)) return null;
  return (
    <button
      type="button"
      disabled={note.pending}
      onClick={note.remove}
      className={DANGER_OUTLINE_BUTTON}
    >
      {t('deleteNote')}
    </button>
  );
}

/**
 * The note's field, named by the view's label ("My coach note on 5... Qc7
 * · you and Gabija see this", so the coach never thinks it private, R-107),
 * then Save, the view's other buttons and the status line. Save does not
 * submit on Enter: the note is multi-line text.
 */
export function CoachNoteFields({
  note,
  labelledBy,
  children,
}: {
  readonly note: CoachNote;
  /** The id of the label that names the field. */
  readonly labelledBy: string;
  /** Beside Save: Cancel on the card, Delete in the sheet. */
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations('coach.shared');
  const statusId = useId();
  const invalid = refused(note.status);
  return (
    <>
      <textarea
        rows={3}
        value={note.text}
        onChange={(event) => {
          note.setText(event.target.value);
        }}
        aria-labelledby={labelledBy}
        aria-describedby={invalid ? statusId : undefined}
        aria-invalid={invalid ? true : undefined}
        className="block w-full rounded-control border border-border-strong bg-surface p-3 text-base text-fg aria-invalid:border-error"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={note.pending}
          onClick={note.save}
          className={PRIMARY_BUTTON}
        >
          {t('saveNote')}
        </button>
        {children}
      </div>
      <CoachNoteStatus note={note} id={statusId} />
    </>
  );
}
