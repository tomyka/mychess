'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

export interface NavButtonsProps {
  /** At the chapter root: start and back are disabled. */
  readonly atRoot: boolean;
  /** At the end of the line: forward is disabled. */
  readonly atEnd: boolean;
  readonly onStart: () => void;
  readonly onBack: () => void;
  readonly onForward: () => void;
}

const BUTTON =
  'inline-flex min-h-touch min-w-touch items-center justify-center rounded-control border border-border-strong bg-surface text-fg disabled:opacity-60';

function Icon({ path }: { readonly path: string }): JSX.Element {
  return (
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
      <path d={path} />
    </svg>
  );
}

/** Start, back and forward: 44x44 icon buttons at the right of the board row. */
export function NavButtons({
  atRoot,
  atEnd,
  onStart,
  onBack,
  onForward,
}: NavButtonsProps): JSX.Element {
  const t = useTranslations('repertoires.nav');
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        aria-label={t('start')}
        disabled={atRoot}
        onClick={onStart}
        className={BUTTON}
      >
        <Icon path="M7 6v12M17 6l-6 6 6 6" />
      </button>
      <button
        type="button"
        aria-label={t('back')}
        disabled={atRoot}
        onClick={onBack}
        className={BUTTON}
      >
        <Icon path="M15 6l-6 6 6 6" />
      </button>
      <button
        type="button"
        aria-label={t('forward')}
        disabled={atEnd}
        onClick={onForward}
        className={BUTTON}
      >
        <Icon path="M9 6l6 6-6 6" />
      </button>
    </div>
  );
}
