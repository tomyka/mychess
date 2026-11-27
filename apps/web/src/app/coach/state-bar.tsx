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

/** The bar's height: 6px in a row, 8px in a page header (spec, Shared pieces). */
const HEIGHT = { row: 'h-1.5', header: 'h-2' } as const;

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
 * violet, due amber, to learn the grey track). The bar is hidden from
 * screen readers: ProgressCounts says the same counts in words beside it
 * (never colour alone, docs/design/README.md).
 */
export function StateBar({
  counts,
  size,
}: {
  readonly counts: ProgressCounts;
  readonly size: keyof typeof HEIGHT;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const whole = totalMoves(counts);
  if (whole === 0) {
    return <p className="text-sm text-fg-muted">{t('nothing')}</p>;
  }
  return (
    <div
      aria-hidden="true"
      className={`flex ${HEIGHT[size]} overflow-hidden rounded-pill bg-border`}
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
  );
}
