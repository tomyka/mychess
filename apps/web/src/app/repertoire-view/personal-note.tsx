'use client';

// The viewer's private note on a move (R-21), the same on every view that
// shows it: the owner's repertoire and an assigned one.
import {
  ASSIGNMENT_REFUSALS,
  REPERTOIRE_ISSUES,
  REPERTOIRE_REFUSALS,
} from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import { saveOnCtrlEnter, useFieldSave, useStatusText } from './field-save';
import { PANEL_LABEL } from './panel-styles';

/**
 * What saving a Personal note came to. Not found is the page's own: the
 * owner's repertoire, or an assignment no longer the viewer's.
 */
export type NoteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal:
        | typeof REPERTOIRE_ISSUES.personalNoteTooLong
        | typeof REPERTOIRE_REFUSALS.notFound
        | typeof ASSIGNMENT_REFUSALS.notFound;
    };

/** Saves the note's text; '' deletes it. */
type SaveNote = (text: string) => Promise<NoteOutcome>;

/** An empty note's one "My note" button, which opens the field (R-116). */
function NoteOpener({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  const t = useTranslations('repertoires.note');
  const hintId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={onOpen}
        aria-describedby={hintId}
        className={`${SECONDARY_BUTTON} gap-2`}
      >
        <LockIcon />
        {t('label')}
      </button>
      <span id={hintId} className="text-sm text-fg-muted">
        {t('private')}
      </span>
    </div>
  );
}

/**
 * The viewer's private note on the move (R-21). Empty, it is one "My
 * note" button that opens the field; written, the field shows at once
 * (R-116).
 */
export function PersonalNote({
  initial,
  onSaveNote,
}: {
  readonly initial: string;
  readonly onSaveNote: SaveNote;
}): JSX.Element {
  const [open, setOpen] = useState(initial !== '');
  if (!open)
    return (
      <NoteOpener
        onOpen={() => {
          setOpen(true);
        }}
      />
    );
  return (
    <NoteField
      initial={initial}
      onSaveNote={onSaveNote}
      focused={initial === ''}
    />
  );
}

/**
 * The note's field: a sunken well with a lock, visibly apart from the
 * comment. An empty note deletes it. `focused`: opened by its button, so
 * the field takes the focus.
 */
function NoteField({
  initial,
  onSaveNote,
  focused,
}: {
  readonly initial: string;
  readonly onSaveNote: SaveNote;
  readonly focused: boolean;
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focused) field.current?.focus();
  }, [focused]);
  const [text, setText] = useState(initial);
  const { status, pending, save } = useFieldSave(onSaveNote);
  const said = useStatusText(status, t('repertoires.note.saved'));
  const refused = status !== 'idle' && status !== 'saved';
  const onKeyDown = saveOnCtrlEnter(() => {
    save(text);
  });
  return (
    <div className="flex flex-col gap-2 rounded-card bg-sunken p-3">
      <NoteHeading fieldId={fieldId} hintId={hintId} />
      <textarea
        ref={field}
        id={fieldId}
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
        aria-describedby={refused ? `${hintId} ${statusId}` : hintId}
        aria-invalid={refused ? true : undefined}
        className="rounded-control border border-border-strong bg-surface p-3 text-base text-fg aria-invalid:border-error"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          save(text);
        }}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {t('repertoires.note.save')}
      </button>
      <StatusLine
        id={statusId}
        text={said}
        tone={status === 'saved' ? 'success' : 'error'}
      />
    </div>
  );
}

/** The lock, the label "My note" and the hint "Only you see this". */
function NoteHeading({
  fieldId,
  hintId,
}: {
  readonly fieldId: string;
  readonly hintId: string;
}): JSX.Element {
  const t = useTranslations('repertoires.note');
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <LockIcon />
      <label htmlFor={fieldId} className={PANEL_LABEL}>
        {t('label')}
      </label>
      <span id={hintId} className="text-sm text-fg-muted">
        {t('private')}
      </span>
    </div>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 text-fg-muted"
      fill="currentColor"
    >
      <path d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm2 0h2V5a1 1 0 0 0-2 0z" />
    </svg>
  );
}
