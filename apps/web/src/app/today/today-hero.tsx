'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { ROUTES, trainingPath } from '../../lib/routes';
import type { TodaySummary } from '../../server/training';
import { HERO_PRIMARY_BUTTON, HERO_SECONDARY_BUTTON } from '../buttons';
import { useReviewTime } from '../training/review-time';
import type { HeroState } from './hero-state';

interface HeroProps {
  readonly state: HeroState;
  readonly summary: TodaySummary;
}

/** When the next review is, when one is scheduled. */
function NextReview({
  next,
}: {
  readonly next: Date | null;
}): JSX.Element | null {
  const t = useTranslations('training.today');
  const reviewTime = useReviewTime();
  return next === null ? null : <p>{t('next', { when: reviewTime(next) })}</p>;
}

/** The card's headline: the due count, the welcome, or that nothing is due. */
function Lead({ state, summary }: HeroProps): JSX.Element {
  const t = useTranslations();
  if (state === 'due')
    return (
      <div>
        <p className="text-4xl font-bold">
          {t('today.dueCount', { count: summary.due })}
        </p>
        <p>{t('today.minutes', { minutes: summary.minutes })}</p>
      </div>
    );
  if (state === 'empty') return <p className="text-lg">{t('today.welcome')}</p>;
  return (
    <div>
      <p className="text-xl font-semibold">
        {state === 'learn'
          ? t('training.today.nothingDue')
          : t('today.allDone')}
      </p>
      <NextReview next={summary.nextDue} />
    </div>
  );
}

/** The new moves today's allowance leaves, main or second button. */
function LearnLink({
  count,
  className,
}: {
  readonly count: number;
  readonly className: string;
}): JSX.Element {
  const t = useTranslations('training.today');
  return (
    <Link href={trainingPath('learn')} className={className}>
      {t('learn', { count })}
    </Link>
  );
}

/** The state's buttons: none when all is done. */
function Actions({ state, summary }: HeroProps): JSX.Element | null {
  const t = useTranslations();
  if (state === 'done') return null;
  return (
    <div className="flex flex-wrap gap-3">
      {state === 'due' ? (
        <Link href={trainingPath('review')} className={HERO_PRIMARY_BUTTON}>
          {t('training.today.start')}
        </Link>
      ) : null}
      {state === 'empty' ? (
        <>
          <Link href={ROUTES.repertoires} className={HERO_PRIMARY_BUTTON}>
            {t('today.create')}
          </Link>
          <Link
            href={ROUTES.repertoireImport}
            className={HERO_SECONDARY_BUTTON}
          >
            {t('today.import')}
          </Link>
        </>
      ) : null}
      {state !== 'empty' && summary.toLearn > 0 ? (
        <LearnLink
          count={summary.toLearn}
          className={
            state === 'due' ? HERO_SECONDARY_BUTTON : HERO_PRIMARY_BUTTON
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Today's hero card (spec, "The hero card"; R-142, R-148, U1-M1-3): an
 * accent card headed "Today's review" for screen readers in every state,
 * while the count is the visual headline; its buttons follow the state.
 */
export function TodayHero({ state, summary }: HeroProps): JSX.Element {
  const t = useTranslations('training.today');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-card bg-accent p-5 text-accent-fg shadow-card"
    >
      <h2
        id={titleId}
        className="text-sm font-semibold uppercase tracking-wide"
      >
        {t('title')}
      </h2>
      <Lead state={state} summary={summary} />
      <Actions state={state} summary={summary} />
    </section>
  );
}
