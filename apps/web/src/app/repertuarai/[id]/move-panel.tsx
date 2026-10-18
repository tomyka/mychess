'use client';

import type { RepertoireMove } from '@mychess/chess';
import { COMMENT_MAX } from '@mychess/domain';
import { useMessages, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { isMessageKey } from '../../../i18n/message-key';
import { SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import type { NoteOutcome } from './actions';

/** What saving a field came to: saved, or a catalogue key. */
export type FieldOutcome =
  { readonly ok: true } | { readonly ok: false; readonly refusal: string };

/** The builder's comment field (absent while browsing). */
export interface CommentEditor {
  /** Saving, or the repertoire changed elsewhere. */
  readonly disabled: boolean;
  readonly onSave: (text: string) => Promise<FieldOutcome>;
}

export interface MovePanelProps {
  /** The chapter's intro (R-66), shown at its root. */
  readonly intro: string | null;
  /** The current move, or null at the chapter's root. */
  readonly move: RepertoireMove | null;
  /** The viewer's Personal note on the move; '' for none. */
  readonly note: string;
  readonly onSaveNote: (text: string) => Promise<NoteOutcome>;
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly commentEditor?: CommentEditor | undefined;
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

/** 'idle', 'saved', or the catalogue key of a refusal. */
type FieldStatus = string;

/** Saves through `onSave` and keeps what the field's status line says. */
function useFieldSave(onSave: (text: string) => Promise<FieldOutcome>) {
  const [status, setStatus] = useState<FieldStatus>('idle');
  const [pending, startTransition] = useTransition();
  const save = (text: string): void => {
    startTransition(async () => {
      try {
        const outcome = await onSave(text);
        setStatus(outcome.ok ? 'saved' : outcome.refusal);
      } catch {
        setStatus('repertoires.failed');
      }
    });
  };
  return { status, pending, save };
}

/** What a field's status line says: `saved` on success, else the refusal. */
function useStatusText(status: FieldStatus, saved: string): string | null {
  const t = useTranslations();
  const messages = useMessages();
  if (status === 'idle') return null;
  if (status === 'saved') return saved;
  return isMessageKey(messages, status) ? t(status) : t('repertoires.failed');
}

/** Ctrl/Cmd + Enter in a textarea saves it (docs/design, Keyboard). */
const saveOnCtrlEnter =
  (save: () => void) =>
  (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    save();
  };

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
function PersonalNote({
  initial,
  onSaveNote,
}: {
  readonly initial: string;
  readonly onSaveNote: MovePanelProps['onSaveNote'];
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
  readonly onSaveNote: MovePanelProps['onSaveNote'];
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

/** The count shown from this many characters on. */
const COUNT_FROM = 1800;

/** The comment's hint (R-105) and, near the limit, its length. */
function CommentHint({
  id,
  length,
}: {
  readonly id: string;
  readonly length: number;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  return (
    <div className="flex flex-wrap justify-between gap-x-3 text-sm text-fg-muted">
      <span id={id}>{t('commentHint')}</span>
      {length >= COUNT_FROM ? (
        <span className={length >= COMMENT_MAX ? 'text-error' : ''}>
          {t('commentCount', { count: length, max: COMMENT_MAX })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The builder's comment (R-102): one paragraph (R-105, the hint says so),
 * a count near the limit, Save, and its own status line.
 */
function CommentField({
  initial,
  editor,
}: {
  readonly initial: string;
  readonly editor: CommentEditor;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const [text, setText] = useState(initial);
  const { status, pending, save } = useFieldSave(editor.onSave);
  const said = useStatusText(status, t('commentSaved'));
  const refused = status !== 'idle' && status !== 'saved';
  const disabled = pending || editor.disabled;
  const onKeyDown = saveOnCtrlEnter(() => {
    if (!disabled) save(text);
  });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className={LABEL}>
        {t('commentLabel')}
      </label>
      <textarea
        id={fieldId}
        rows={4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
        aria-describedby={refused ? `${hintId} ${statusId}` : hintId}
        aria-invalid={refused ? true : undefined}
        className="rounded-control border border-border-strong bg-surface p-3 text-base text-fg aria-invalid:border-error"
      />
      <CommentHint id={hintId} length={text.length} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          save(text);
        }}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {t('commentSave')}
      </button>
      <StatusLine
        id={statusId}
        text={said}
        tone={status === 'saved' ? 'success' : 'error'}
      />
    </div>
  );
}

/** The comment as text (browsing) or as the builder's field. */
function Comment({
  move,
  editor,
}: {
  readonly move: RepertoireMove;
  readonly editor: CommentEditor | undefined;
}): JSX.Element {
  const t = useTranslations('repertoires.panel');
  if (editor !== undefined)
    return (
      <CommentField
        key={`${move.from}|${move.san}`}
        initial={move.comment ?? ''}
        editor={editor}
      />
    );
  return (
    <>
      <p className={LABEL}>{t('comment')}</p>
      {move.comment === null ? (
        <p className="text-fg-muted">{t('noComment')}</p>
      ) : (
        <p>{move.comment}</p>
      )}
    </>
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
  commentEditor,
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
        <Comment move={move} editor={commentEditor} />
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
