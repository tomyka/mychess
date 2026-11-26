'use client';

// A move's comment field (R-102) in builder mode, and its marks as words.
// While browsing the comment strip shows the comment (comment-strip.tsx).
import type { RepertoireMove } from '@mychess/chess';
import { COMMENT_MAX } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useId, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import {
  saveOnCtrlEnter,
  useFieldSave,
  useStatusText,
  type FieldOutcome,
} from './field-save';
import { PANEL_LABEL } from './panel-styles';

/** The builder's comment field (absent while browsing). */
export interface CommentEditor {
  /** Saving, or the repertoire changed elsewhere. */
  readonly disabled: boolean;
  readonly onSave: (text: string) => Promise<FieldOutcome>;
}

/** The move's arrows and circles as words, so the marks are not colour only. */
export function MarksText({
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
 * The builder's comment on `move` (R-102): one paragraph (R-105, the hint
 * says so), a count near the limit, Save, and its own status line. Keyed
 * by the move, so a new move starts from its own comment.
 */
export function CommentField({
  move,
  editor,
}: {
  readonly move: RepertoireMove;
  readonly editor: CommentEditor;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  const fieldId = useId();
  const hintId = useId();
  const statusId = useId();
  const [text, setText] = useState(move.comment ?? '');
  const { status, pending, save } = useFieldSave(editor.onSave);
  const said = useStatusText(status, t('commentSaved'));
  const refused = status !== 'idle' && status !== 'saved';
  const disabled = pending || editor.disabled;
  const onKeyDown = saveOnCtrlEnter(() => {
    if (!disabled) save(text);
  });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className={PANEL_LABEL}>
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
