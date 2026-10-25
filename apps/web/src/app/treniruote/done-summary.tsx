'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, type JSX } from 'react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { useReviewTime } from './review-time';
import type { RepertoireProgress } from './session-progress';

/** What a session did: a review's outcomes, or the moves a learn pass taught. */
export type SessionCounts =
  | {
      readonly kind: 'review';
      readonly reviewed: number;
      readonly correct: number;
      readonly lapses: number;
    }
  | { readonly kind: 'learn'; readonly learned: number };

export interface DoneSummaryProps {
  readonly counts: SessionCounts;
  /** Where the repertoires in scope stand now (repertoireProgress). */
  readonly progress: RepertoireProgress;
  /** Given when the queue rebuilt from this session's reviews has more (R-62). */
  readonly onContinue?: () => void;
  /** Given when today's new-move allowance is not used up (R-146). */
  readonly learnHref?: string;
  /** Back to where the player came from. */
  readonly doneHref: string;
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
 * The Done state's view of the repertoires: when the next review is, and
 * a bar of learned, due and to-learn moves with the same counts in words.
 */
function Standing({
  progress,
}: {
  readonly progress: RepertoireProgress;
}): JSX.Element {
  const t = useTranslations('training.done');
  const reviewTime = useReviewTime();
  const { learned, due, toLearn, nextReview } = progress;
  const whole = learned + toLearn;
  return (
    <div className="flex flex-col gap-3">
      {nextReview === null ? null : (
        <p className="text-center text-fg-muted">
          {t('next', { when: reviewTime(nextReview) })}
        </p>
      )}
      <div
        aria-hidden="true"
        className="flex h-2 overflow-hidden rounded-pill bg-sunken"
      >
        <div
          className="bg-learned"
          style={{ width: segment(learned - due, whole) }}
        />
        <div className="bg-due" style={{ width: segment(due, whole) }} />
      </div>
      <p className="text-center text-sm text-fg-muted">
        {t('progress', { learned, due, toLearn })}
      </p>
    </div>
  );
}

/**
 * The Done state (docs/design/training-screen.md): the session's counts and
 * the ways on. Focus moves to its heading when it appears.
 */
export function DoneSummary({
  counts,
  progress,
  onContinue,
  learnHref,
  doneHref,
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
          [t('correct'), counts.correct, 'text-success'],
          [t('lapses'), counts.lapses, 'text-error'],
        ]
      : [[t('learned'), counts.learned, 'text-learned']];
  return (
    <section aria-labelledby="training-done" className="flex flex-col gap-6">
      <h2
        id="training-done"
        ref={heading}
        tabIndex={-1}
        className="text-center text-2xl font-bold"
      >
        {t('title')}
      </h2>
      <Stats stats={stats} />
      <Standing progress={progress} />
      <div className="flex flex-wrap gap-3">
        {onContinue === undefined ? null : (
          <button type="button" onClick={onContinue} className={PRIMARY_BUTTON}>
            {t('continue')}
          </button>
        )}
        {learnHref === undefined ? null : (
          <Link href={learnHref} className={SECONDARY_BUTTON}>
            {t('learn')}
          </Link>
        )}
        <Link href={doneHref} className={SECONDARY_BUTTON}>
          {t('done')}
        </Link>
      </div>
    </section>
  );
}
