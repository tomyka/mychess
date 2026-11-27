import {
  isUnstarted,
  percentLearned,
  type ProgressCounts as Counts,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { Fragment, type JSX } from 'react';
import { MasteredBadge } from '../mastered-badge';

/** The counts said after the share learned, the due one in its tone. */
const PARTS = [
  ['due', 'text-due'],
  ['skipped', ''],
  ['notStarted', ''],
] as const;

/** The share learned, then the non-zero counts in words, joined by " · ". */
function Parts({
  counts,
  percent,
}: {
  readonly counts: Counts;
  readonly percent: number;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const shown = PARTS.filter(([part]) => counts[part] > 0);
  return (
    <span className="text-pretty">
      <span>{t('percent', { percent })}</span>
      {shown.map(([part, tone]) => (
        <Fragment key={part}>
          {t('separator')}
          <span className={tone}>
            {t(`part.${part}`, { count: counts[part] })}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A repertoire's progress in words beside its StateBar (spec, Shared
 * pieces; R-231): "50% learned", then only the counts above zero, or "Not
 * started · N moves" when nothing is started, and the Mastered pill when
 * mastered (R-178). Nothing for an empty repertoire, where the bar says
 * "Nothing to learn".
 */
export function ProgressCounts({
  counts,
  mastered,
}: {
  readonly counts: Counts;
  readonly mastered: boolean;
}): JSX.Element | null {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(counts);
  if (percent === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
      {isUnstarted(counts) ? (
        <span>{t('notStarted', { count: counts.notStarted })}</span>
      ) : (
        <Parts counts={counts} percent={percent} />
      )}
      {mastered ? <MasteredBadge /> : null}
    </p>
  );
}
