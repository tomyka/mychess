'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { trainingPath } from '../../lib/routes';
import type { TrainingCounts } from '../../lib/training-counts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';

/**
 * The player's training of the repertoire a page shows. Absent where the
 * viewer does not train it: a coach's view, or a paused assignment (R-46).
 */
export interface PanelTraining {
  readonly repertoireId: string;
  /** Due now and to learn today, as the page loaded. */
  readonly counts: TrainingCounts;
}

/**
 * Review and learn this repertoire only (R-142), each with its count, at
 * the top of the panel.
 */
export function TrainButtons({
  training,
}: {
  readonly training: PanelTraining;
}): JSX.Element {
  const t = useTranslations('training.repertoire');
  const { repertoireId, counts } = training;
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href={trainingPath('review', repertoireId)}
        className={PRIMARY_BUTTON}
      >
        {t('review', { count: counts.due })}
      </Link>
      <Link
        href={trainingPath('learn', repertoireId)}
        className={SECONDARY_BUTTON}
      >
        {t('learn', { count: counts.toLearn })}
      </Link>
    </div>
  );
}
