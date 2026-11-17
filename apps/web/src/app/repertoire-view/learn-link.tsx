'use client';

import {
  toLearnCount,
  type LearnFocus,
  type RepertoireGraph,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, type JSX } from 'react';
import { learnDayOf } from '../../lib/learn-scope';
import { learnPath } from '../../lib/routes';
import { SECONDARY_BUTTON } from '../buttons';
import type { PanelTraining } from './train-buttons';

/**
 * "Learn (n)" for one chapter or one line (R-206): the new moves learning
 * it would teach today, within the daily limit; nothing when that is 0.
 * Named for a chapter by its title, else as this line (lead answer 4).
 */
export function LearnLink({
  training,
  graph,
  focus,
  subject,
}: {
  readonly training: PanelTraining;
  readonly graph: RepertoireGraph;
  readonly focus: Omit<LearnFocus, 'repertoireId'>;
  /** The chapter's title; absent for the current line. */
  readonly subject?: string;
}): JSX.Element | null {
  const t = useTranslations('training.repertoire');
  const { repertoireId, learn } = training;
  const { chapterId, lineIndex } = focus;
  const count = useMemo(
    () =>
      toLearnCount(
        learnDayOf(repertoireId, graph, learn, {
          chapterId,
          ...(lineIndex === undefined ? {} : { lineIndex }),
        }),
      ),
    [repertoireId, graph, learn, chapterId, lineIndex],
  );
  if (count === 0) return null;
  return (
    <Link
      href={learnPath(repertoireId, focus)}
      aria-label={
        subject === undefined
          ? t('learnLine', { count })
          : t('learnIn', { count, subject })
      }
      className={`${SECONDARY_BUTTON} shrink-0`}
    >
      {t('learn', { count })}
    </Link>
  );
}
