import {
  percentLearned,
  totalMoves,
  type ProgressCounts,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** One segment's width as a share of the whole, which is never 0 here. */
const segment = (part: number, whole: number): string =>
  `${String((part / whole) * 100)}%`;

/** The Mastered pill (R-151), the same wherever progress is shown. */
export function MasteredBadge(): JSX.Element {
  const t = useTranslations('coach.progress');
  return (
    <span className="w-fit rounded-pill border border-transparent bg-success-subtle px-2 py-0.5 text-sm font-semibold text-success">
      {t('mastered')}
    </span>
  );
}

/**
 * The share learned in words, and whether there is anything to learn: an
 * empty repertoire says "nothing to learn" rather than a percentage.
 */
export function usePercentLearned(counts: ProgressCounts): {
  readonly text: string;
  readonly empty: boolean;
} {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(counts);
  return percent === null
    ? { text: t('nothing'), empty: true }
    : { text: t('percent', { percent }), empty: false };
}

/**
 * The four states of R-151 as one bar (learned violet, "I know this" muted
 * violet, due amber, to learn the grey track), with the same counts in words
 * (never colour alone, docs/design/README.md) and the Mastered badge.
 */
export function StateBar({
  counts,
  mastered,
}: {
  readonly counts: ProgressCounts;
  readonly mastered: boolean;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const whole = totalMoves(counts);
  if (whole === 0) {
    return <p className="text-sm text-fg-muted">{t('nothing')}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div
        aria-hidden="true"
        className="flex h-2 overflow-hidden rounded-pill bg-border"
      >
        <div
          className="bg-learned"
          style={{ width: segment(counts.learned, whole) }}
        />
        <div
          className="bg-skipped"
          style={{ width: segment(counts.skipped, whole) }}
        />
        <div className="bg-due" style={{ width: segment(counts.due, whole) }} />
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span className="text-pretty">{t('counts', { ...counts })}</span>
        {mastered ? <MasteredBadge /> : null}
      </p>
    </div>
  );
}
