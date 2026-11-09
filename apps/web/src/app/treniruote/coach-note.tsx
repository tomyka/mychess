'use client';

// Coach notes in training (#322, R-174): which note goes with a move, and
// the panel's box that shows it. When a drill shows it is the drill state's
// rule: the learn pass with the move's arrow, a review once the move is
// answered, so a note never gives the answer away.
import type { RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { TrainingData } from '../../lib/training-data';

/**
 * The Coach note on `move` of repertoire `repertoireId`, or null. On a
 * repertoire a coach assigned, the coach's comments are Coach notes
 * (R-102); a comment on the player's own repertoire is not one.
 */
export function coachNoteOn(
  entries: TrainingData['entries'],
  repertoireId: string | undefined,
  move: RepertoireMove | undefined,
): string | null {
  const entry = entries.find((e) => e.id === repertoireId);
  const text = move?.comment?.trim() ?? '';
  return entry?.kind === 'assigned' && text !== '' ? text : null;
}

/** A Coach note in the drill's panel, read-only; nothing when there is none. */
export function DrillCoachNote({
  text,
}: {
  readonly text: string | null;
}): JSX.Element | null {
  const t = useTranslations('training.drill');
  if (text === null) return null;
  return (
    <section
      role="note"
      aria-label={t('coachNote')}
      className="flex flex-col gap-1 rounded-card border border-border p-3"
    >
      <p className="text-sm font-medium text-fg-muted">{t('coachNote')}</p>
      <p className="whitespace-pre-line">{text}</p>
    </section>
  );
}
