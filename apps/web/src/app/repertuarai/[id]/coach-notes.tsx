'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { PANEL_LABEL } from './panel-styles';

/** One coach's note on a move, as its reader sees it. */
export interface MoveCoachNote {
  readonly coachId: string;
  readonly coachName: string;
  readonly text: string;
}

/**
 * The coaches' notes on a move, read-only, each marked with its coach's
 * name (R-107, R-125); nothing when there are none.
 */
export function CoachNotes({
  notes,
}: {
  readonly notes: readonly MoveCoachNote[];
}): JSX.Element | null {
  const t = useTranslations('coachNote');
  if (notes.length === 0) return null;
  return (
    <ul aria-label={t('list')} className="flex flex-col gap-2">
      {notes.map((note) => (
        <li
          key={note.coachId}
          className="flex flex-col gap-1 rounded-card border border-border p-3"
        >
          <p className={PANEL_LABEL}>
            {t('byCoach', { name: note.coachName })}
          </p>
          <p className="whitespace-pre-line">{note.text}</p>
        </li>
      ))}
    </ul>
  );
}
