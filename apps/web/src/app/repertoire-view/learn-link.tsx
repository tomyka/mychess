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
import { TONAL_BUTTON } from '../buttons';
import type { TrainNow } from '../../server/training';

/**
 * "Learn this line (n)" or "Learn this chapter (n)" (R-206): the new moves
 * learning it would teach today, within the daily limit; nothing when that
 * is 0.
 */
export function LearnLink({
  training,
  graph,
  focus,
}: {
  readonly training: TrainNow;
  readonly graph: RepertoireGraph;
  /** A line of the chapter, or the whole chapter without `lineIndex`. */
  readonly focus: Omit<LearnFocus, 'repertoireId'>;
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
    <Link href={learnPath(repertoireId, focus)} className={TONAL_BUTTON}>
      {lineIndex === undefined
        ? t('learnThisChapter', { count })
        : t('learnThisLine', { count })}
    </Link>
  );
}
