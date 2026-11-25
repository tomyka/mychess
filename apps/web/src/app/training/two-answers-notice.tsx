'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { OtherAnswer } from './drill-notices';

/**
 * The two-answers notice: one sentence for each other repertoire and its
 * move (R-54, decision 4). It only informs: the drill still expects its own
 * repertoire's move. When it shows is the drill's (drill-notices.ts).
 */
export function TwoAnswersNotice({
  answers,
}: {
  readonly answers: readonly OtherAnswer[];
}): JSX.Element | null {
  const t = useTranslations('training.twoAnswers');
  if (answers.length === 0) return null;
  return (
    <div
      role="note"
      className="rounded-card bg-accent-subtle px-4 py-3 text-sm text-fg"
    >
      {answers.map((a) => (
        <p key={a.repertoireId}>{t('other', { name: a.name, move: a.san })}</p>
      ))}
    </div>
  );
}
