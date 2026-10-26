'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { trainingPath } from '../lib/routes';
import type { TodaySummary } from '../server/training';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';
import { SECTION, SECTION_TITLE } from './nustatymai/styles';
import { useReviewTime } from './treniruote/review-time';

/** What is due: the count and the estimate, or when the next review is. */
function DueLine({ summary }: { readonly summary: TodaySummary }): JSX.Element {
  const t = useTranslations('training.today');
  const reviewTime = useReviewTime();
  if (summary.due > 0)
    return (
      <p className="text-lg font-semibold">
        {t('due', { count: summary.due, minutes: summary.minutes })}
      </p>
    );
  return (
    <>
      <p>{t('nothingDue')}</p>
      {summary.nextDue === null ? null : (
        <p className="text-fg-muted">
          {t('next', { when: reviewTime(summary.nextDue) })}
        </p>
      )}
    </>
  );
}

/**
 * Home's "Today" block (R-142, U1-M1-3): the due count and about how long
 * it takes, shown before starting, then the review of every repertoire the
 * player trains and the new moves today's allowance leaves.
 */
export function TodayBlock({
  summary,
}: {
  readonly summary: TodaySummary;
}): JSX.Element {
  const t = useTranslations('training.today');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <DueLine summary={summary} />
      <div className="flex flex-wrap gap-3">
        {summary.due > 0 ? (
          <Link href={trainingPath('review')} className={PRIMARY_BUTTON}>
            {t('start')}
          </Link>
        ) : null}
        {summary.toLearn > 0 ? (
          // The main action when there is nothing to review.
          <Link
            href={trainingPath('learn')}
            className={summary.due > 0 ? SECONDARY_BUTTON : PRIMARY_BUTTON}
          >
            {t('learn', { count: summary.toLearn })}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
