'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type JSX, type SubmitEvent } from 'react';

export interface MoveInputProps {
  /**
   * A typed move (SAN or coordinates), trimmed. Returns whether the page took
   * it: the field clears only then, so a refused move can be corrected.
   */
  readonly onTyped: (text: string) => boolean;
  /** While saving or in draw mode. */
  readonly disabled?: boolean;
}

/**
 * The board row's typed-move field (docs/design/repertoire-screen.md, "Board
 * row"): the keyboard and screen-reader way to play a move, and a quick one
 * on a phone.
 */
export function MoveInput({
  onTyped,
  disabled = false,
}: MoveInputProps): JSX.Element {
  const t = useTranslations('board.moveInput');
  const id = useId();
  const [text, setText] = useState('');

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const move = text.trim();
    if (move !== '' && onTyped(move)) setText('');
  }

  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-1 gap-1">
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <input
        id={id}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        disabled={disabled}
        placeholder={t('label')}
        enterKeyHint="go"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="min-h-touch w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-base text-fg disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled}
        aria-label={t('submit')}
        className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-control bg-accent text-accent-fg disabled:opacity-60"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
