'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, type JSX } from 'react';
import { PRIMARY_BUTTON, QUIET_ACTION, TONAL_BUTTON } from '../buttons';
import { Icon, TICK_ICON } from '../line-icon';
import { CARD } from '../surfaces';
import { doneSteps, type DoneOffer, type DoneStep } from './done-offer';
import type { TrainingLinks } from './drill';
import { useReviewTime } from './review-time';
import type { DayStanding, TrainingProgress } from '@mychess/chess';

/** What a session did: a review's outcomes, or the moves a learn pass taught. */
export type SessionCounts =
  | {
      readonly kind: 'review';
      readonly reviewed: number;
      readonly passed: number;
      readonly lapses: number;
    }
  | { readonly kind: 'learn'; readonly learned: number };

export interface DoneSummaryProps {
  readonly counts: SessionCounts;
  /** Where the repertoires in scope stand now (trainingProgress). */
  readonly progress: TrainingProgress;
  /** Where the player's day stands now (dayStanding). */
  readonly standing: DayStanding;
}

export interface DoneActionsProps {
  /** The steps the finished drill offers. */
  readonly offer: DoneOffer;
  /** Where Start review, Learn new moves and Done lead. */
  readonly links: TrainingLinks;
  /** Continue: a new session over what is due now (R-62). */
  readonly onContinue: () => void;
}

type Stat = readonly [label: string, value: number, tone: string];

function Stats({ stats }: { readonly stats: readonly Stat[] }): JSX.Element {
  return (
    <dl className="flex justify-center gap-8 text-center">
      {stats.map(([label, value, tone]) => (
        <div key={label} className="flex flex-col-reverse">
          <dt className="text-sm text-fg-muted">{label}</dt>
          <dd className={`text-4xl font-bold tabular-nums ${tone}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One segment of the progress bar, as a share of its width. */
const segment = (part: number, whole: number): string =>
  `${String(whole === 0 ? 0 : (part / whole) * 100)}%`;

/**
 * Where the day stands (#319): the moves still due, else today's review
 * done or not (said only after a review, never after a learn pass), and
 * when the next review is.
 */
function DayLine({
  kind,
  standing,
}: {
  readonly kind: SessionCounts['kind'];
  readonly standing: DayStanding;
}): JSX.Element {
  const t = useTranslations('training.done');
  const reviewTime = useReviewTime();
  if (standing.kind === 'due')
    return (
      <p className="text-center font-medium">
        {t('stillDue', { count: standing.count })}
      </p>
    );
  const { next } = standing;
  return (
    <div className="flex flex-col gap-1 text-center">
      {kind === 'review' && standing.kind === 'dayDone' ? (
        <p className="font-medium">{t('dayDone')}</p>
      ) : null}
      {next === null ? null : (
        <p className="text-fg-muted">{t('next', { when: reviewTime(next) })}</p>
      )}
    </div>
  );
}

/**
 * The Done state's view of the repertoires: where the day stands, and a
 * bar of learned, due and to-learn moves with the same counts in words.
 */
function Standing({
  kind,
  progress,
  standing,
}: {
  readonly kind: SessionCounts['kind'];
  readonly progress: TrainingProgress;
  readonly standing: DayStanding;
}): JSX.Element {
  const t = useTranslations('training.done');
  const { reviewed, due, toLearn } = progress;
  const whole = reviewed + toLearn;
  return (
    <div className="flex flex-col gap-3">
      <DayLine kind={kind} standing={standing} />
      <div
        aria-hidden="true"
        className="flex h-2 overflow-hidden rounded-pill bg-border"
      >
        <div
          className="bg-learned"
          style={{ width: segment(reviewed - due, whole) }}
        />
        <div className="bg-due" style={{ width: segment(due, whole) }} />
      </div>
      <p className="text-center text-sm text-fg-muted">
        {t('progress', { learned: reviewed, due, toLearn })}
      </p>
    </div>
  );
}

/**
 * A step's look: the main one full width on a phone (the rest wrap under
 * it), any other next step tonal, Done quiet beside them.
 */
function stepClass(step: DoneStep, primary: DoneStep | undefined): string {
  if (step === primary)
    return `${PRIMARY_BUTTON} grow basis-full lg:basis-auto`;
  return step === 'finish' ? QUIET_ACTION : `${TONAL_BUTTON} grow`;
}

/** Where each linked step leads. */
const HREF = {
  review: 'review',
  learn: 'learn',
  finish: 'back',
} as const satisfies Record<Exclude<DoneStep, 'continue'>, keyof TrainingLinks>;

/** Each step's words (`training.done`). */
const LABEL = {
  continue: 'continue',
  review: 'review',
  learn: 'learn',
  finish: 'done',
} as const satisfies Record<DoneStep, string>;

/**
 * The Done state's ways on, for the frame's bottom bar: the steps offered in
 * their order (doneSteps), the first of them the main button, then Done.
 */
export function DoneActions({
  offer,
  links,
  onContinue,
}: DoneActionsProps): JSX.Element {
  const t = useTranslations('training.done');
  const steps = doneSteps(offer);
  const [primary] = steps;
  return (
    <>
      {steps.map((step) =>
        step === 'continue' ? (
          <button
            key={step}
            type="button"
            onClick={onContinue}
            className={stepClass(step, primary)}
          >
            {t(LABEL[step])}
          </button>
        ) : (
          <Link
            key={step}
            href={links[HREF[step]]}
            className={stepClass(step, primary)}
          >
            {t(LABEL[step])}
          </Link>
        ),
      )}
    </>
  );
}

/**
 * The Done state (docs/design/training-screen.md): the session's counts and
 * where the repertoires stand; its buttons are DoneActions, in the bottom
 * bar. Focus moves to its heading when it appears.
 */
export function DoneSummary({
  counts,
  progress,
  standing,
}: DoneSummaryProps): JSX.Element {
  const t = useTranslations('training.done');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const stats: readonly Stat[] =
    counts.kind === 'review'
      ? [
          [t('reviewed'), counts.reviewed, 'text-fg'],
          [t('firstTry'), counts.passed, 'text-success'],
          [t('lapses'), counts.lapses, 'text-error'],
        ]
      : [[t('learned'), counts.learned, 'text-learned']];
  return (
    <section
      aria-labelledby="training-done"
      className={`${CARD} flex flex-col gap-6 p-6`}
    >
      <span
        aria-hidden="true"
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-subtle text-success"
      >
        <Icon path={TICK_ICON} className="size-6" strokeWidth={3} />
      </span>
      <h2
        id="training-done"
        ref={heading}
        tabIndex={-1}
        className="text-center text-2xl font-bold"
      >
        {t('title')}
      </h2>
      <Stats stats={stats} />
      <Standing kind={counts.kind} progress={progress} standing={standing} />
    </section>
  );
}
