'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { PANEL_LABEL } from './panel-styles';

/** One coach's note on a move, as its reader sees it. */
export interface MoveCoachNote {
  /** The coach's account; null for the note a fork kept (one per move). */
  readonly coachId: string | null;
  readonly coachName: string;
  readonly text: string;
}

/** The list key of the note a fork kept: a fork has one coach. */
const FORK_NOTE = 'fork';

/**
 * One coach note as a card, read-only: whose it is, then its text. The
 * repertoire page and the training drills both show a note this way.
 */
export function CoachNoteCard({
  label,
  text,
}: {
  /** Whose note it is, already translated. */
  readonly label: string;
  readonly text: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border p-3">
      <p className={PANEL_LABEL}>{label}</p>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
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
        <li key={note.coachId ?? FORK_NOTE}>
          <CoachNoteCard
            label={t('byCoach', { name: note.coachName })}
            text={note.text}
          />
        </li>
      ))}
    </ul>
  );
}
