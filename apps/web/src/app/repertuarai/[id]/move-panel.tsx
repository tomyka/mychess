'use client';

import type { RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import {
  useId,
  useState,
  useTransition,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import type { NoteOutcome } from './actions';

export interface MovePanelProps {
  /** The chapter's intro (R-66), shown at its root. */
  readonly intro: string | null;
  /** The current move, or null at the chapter's root. */
  readonly move: RepertoireMove | null;
  /** The viewer's Personal note on the move; '' for none. */
  readonly note: string;
  readonly onSaveNote: (text: string) => Promise<NoteOutcome>;
}

const LABEL = 'text-sm font-semibold text-fg-muted';

/** The move's arrows and circles as words, so the marks are not colour only. */
function MarksText({
  move,
}: {
  readonly move: RepertoireMove;
}): JSX.Element | null {
  const t = useTranslations('repertoires');
  const arrows = move.arrows.map((a) =>
    t('panel.arrow', { from: a.from, to: a.to, color: t(`colors.${a.color}`) }),
  );
  const circles = move.circles.map((c) =>
    t('panel.circle', { square: c.square, color: t(`colors.${c.color}`) }),
  );
  if (arrows.length + circles.length === 0) return null;
  return (
    <div className="sr-only">
      {arrows.length > 0 ? (
        <p>{t('panel.arrows', { list: arrows.join('; ') })}</p>
      ) : null}
      {circles.length > 0 ? (
        <p>{t('panel.circles', { list: circles.join('; ') })}</p>
      ) : null}
    </div>
  );
}

type NoteStatus = 'idle' | 'saved' | NoteRefusal | 'repertoires.failed';
type NoteRefusal = Extract<NoteOutcome, { ok: false }>['refusal'];

/** Saves through `onSaveNote` and keeps what the status line says. */
function useNoteSave(onSaveNote: MovePanelProps['onSaveNote']) {
  const [status, setStatus] = useState<NoteStatus>('idle');
  const [pending, startTransition] = useTransition();
  const save = (text: string): void => {
    startTransition(async () => {
      try {
        const outcome = await onSaveNote(text);
        setStatus(outcome.ok ? 'saved' : outcome.refusal);
      } catch {
        setStatus('repertoires.failed');
      }
    });
  };
  return { status, pending, save };
}

/**
 * The viewer's private note on the move (R-21): a sunken well with a lock,
 * visibly apart from the comment. An empty note deletes it.
 */
function PersonalNote({
  initial,
  onSaveNote,
}: {
  readonly initial: string;
  readonly onSaveNote: MovePanelProps['onSaveNote'];
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const [text, setText] = useState(initial);
  const { status, pending, save } = useNoteSave(onSaveNote);
  const refused = status !== 'idle' && status !== 'saved';
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    save(text);
  }
  return (
    <div className="flex flex-col gap-2 rounded-card bg-sunken p-3">
      <NoteHeading fieldId={fieldId} hintId={hintId} />
      <textarea
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
        text={
          status === 'idle'
            ? null
            : t(status === 'saved' ? 'repertoires.note.saved' : status)
        }
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
      <label htmlFor={fieldId} className={LABEL}>
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

/**
 * The position section (docs/design/repertoire-screen.md): at the chapter
 * root its intro; on a move its comment, its marks as text for screen
 * readers, and the viewer's private note.
 */
export function MovePanel({
  intro,
  move,
  note,
  onSaveNote,
}: MovePanelProps): JSX.Element | null {
  const t = useTranslations('repertoires.panel');
  if (move === null)
    return intro === null ? null : (
      <section aria-label={t('intro')} className="flex flex-col gap-1">
        <p className={LABEL}>{t('intro')}</p>
        <p>{intro}</p>
      </section>
    );
  return (
    <section aria-label={t('comment')} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className={LABEL}>{t('comment')}</p>
        {move.comment === null ? (
          <p className="text-fg-muted">{t('noComment')}</p>
        ) : (
          <p>{move.comment}</p>
        )}
        <MarksText move={move} />
      </div>
      <PersonalNote
        key={`${move.from}|${move.san}`}
        initial={note}
        onSaveNote={onSaveNote}
      />
    </section>
  );
}
