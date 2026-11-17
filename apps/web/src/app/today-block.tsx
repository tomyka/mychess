'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { trainingPath } from '../lib/routes';
import type { TodaySummary } from '../server/training';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';
import { SECTION, SECTION_TITLE, TEXT_LINK } from './nustatymai/styles';
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
 * Each repertoire with due moves, most urgent first: its name a link to
 * the review of it alone (R-207, R-142), its side and count after it,
 * which never wrap apart on a phone (UX sign-off).
 */
function DueRepertoires({
  repertoires,
}: {
  readonly repertoires: TodaySummary['repertoires'];
}): JSX.Element | null {
  const t = useTranslations();
  if (repertoires.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {repertoires.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-x-3"
        >
          <Link
            href={trainingPath('review', r.id)}
            className={`${TEXT_LINK} inline-flex min-h-touch min-w-0 items-center break-words`}
          >
            {r.name}
          </Link>{' '}
          <span className="whitespace-nowrap text-sm text-fg-muted">
            {t('training.today.repertoireCounts', {
              side: t(`repertoires.create.${r.side}`),
              count: r.due,
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Home's "Today" block (R-142, U1-M1-3): the due count and about how long
 * it takes, shown before starting, each repertoire's due moves (R-207),
 * then the review of every repertoire the player trains and the new moves
 * today's allowance leaves.
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
      <DueRepertoires repertoires={summary.repertoires} />
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
