'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES, trainingPath } from '../../lib/routes';
import type { RepertoireTraining } from '../../server/training';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { TEXT_LINK } from '../settings/styles';

/**
 * The player's training of the repertoire a page shows. Absent where the
 * viewer does not train it: a coach's view, or a paused assignment (R-46).
 */
export interface PanelTraining extends RepertoireTraining {
  readonly repertoireId: string;
}

/** The button weight of an action: the main one, or any other. */
const weight = (main: boolean): string =>
  main ? PRIMARY_BUTTON : SECONDARY_BUTTON;

/**
 * Review and learn this repertoire only (R-142), each with its count, at
 * the top of the panel. The main action is Review while moves are due,
 * else Learn while there are new moves, else neither. Once today's new
 * moves are used while moves are left, Learn gives way to a line that says
 * so and leads to the setting (decision 11).
 */
export function TrainButtons({
  training,
}: {
  readonly training: PanelTraining;
}): JSX.Element {
  const t = useTranslations('training.repertoire');
  const { repertoireId, counts } = training;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={trainingPath('review', repertoireId)}
        className={weight(counts.due > 0)}
      >
        {t('review', { count: counts.due })}
      </Link>
      {training.limitReached ? (
        <p className="text-fg-muted">
          {t('limitReached', { count: training.learn.limits.newPerDay })}{' '}
          <Link href={ROUTES.trainingSettings} className={TEXT_LINK}>
            {t('limitSettings')}
          </Link>
        </p>
      ) : (
        <Link
          href={trainingPath('learn', repertoireId)}
          className={weight(counts.due === 0 && counts.toLearn > 0)}
        >
          {t('learn', { count: counts.toLearn })}
        </Link>
      )}
    </div>
  );
}
