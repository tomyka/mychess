'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, type JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { EMPTY_BOARD } from '../repertoire-view';
import {
  FRAME_BOARD,
  FRAME_CARD,
  FRAME_HEAD,
  FRAME_MAIN,
  FRAME_PANEL,
  FRAME_TOP,
} from './frame-classes';

interface TrainingErrorProps {
  /** What failed. Its message may name the player, so it is never shown or logged. */
  readonly error: Error & { readonly digest?: string };
  /** Fetches the page again and re-renders it (Next's error boundary). */
  readonly retry: () => void;
}

/** A circle with an exclamation mark, in the error colour; the words carry the meaning. */
function ErrorIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-error"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16h.01" />
    </svg>
  );
}

/**
 * The training page when the session could not load
 * (docs/design/training-screen.md, Error case 1): the board as while
 * loading, empty, and in the panel one line of what failed, "Try again"
 * and "Back". Focus moves to the line. Only the error's digest is logged:
 * it matches the server's log and names no one.
 */
export default function TrainingError({
  error,
  retry,
}: TrainingErrorProps): JSX.Element {
  const t = useTranslations('training');
  const message = useRef<HTMLParagraphElement>(null);
  const { digest } = error;
  useEffect(() => {
    message.current?.focus();
  }, []);
  useEffect(() => {
    if (digest !== undefined) console.error('training: load failed', digest);
  }, [digest]);
  return (
    <main className={FRAME_MAIN}>
      <div aria-hidden="true" className={FRAME_CARD} />
      <div aria-hidden="true" className={FRAME_HEAD}>
        <div className={FRAME_TOP} />
      </div>
      <div
        aria-hidden="true"
        style={EMPTY_BOARD}
        className={`${FRAME_BOARD} aspect-square w-full lg:rounded-board`}
      />
      <div className={FRAME_PANEL}>
        <div className="flex items-start gap-2">
          <ErrorIcon />
          <p ref={message} tabIndex={-1} className="min-w-0 flex-1">
            {t('loadFailed')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={retry} className={PRIMARY_BUTTON}>
            {t('tryAgain')}
          </button>
          <Link href={ROUTES.home} className={SECONDARY_BUTTON}>
            {t('back')}
          </Link>
        </div>
      </div>
    </main>
  );
}
