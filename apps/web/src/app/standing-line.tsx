import { percentLearned, totalMoves, type Standing } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { MasteredBadge } from './mastered-badge';
import { LearnedBar } from './learned-bar';

/**
 * What the line says for a set with own moves, not mastered, learned to
 * `percent`: New with the size, or the share learned and the due count
 * when above zero. The repertoire page's summary row passes no due count
 * (its Review button says it).
 */
export function useStandingText(
  standing: Standing,
  percent: number,
  due: number,
): string {
  const t = useTranslations('standing');
  const total = totalMoves(standing.counts);
  if (standing.counts.notStarted === total) return t('new', { count: total });
  return due > 0
    ? t('learnedDue', { percent, due })
    : t('learned', { percent });
}

/** The muted line under the bar, for a set not mastered. */
function StandingText({
  standing,
  percent,
  due,
}: {
  readonly standing: Standing;
  readonly percent: number;
  readonly due: number;
}): JSX.Element {
  const text = useStandingText(standing, percent, due);
  return <span className="text-sm text-fg-muted">{text}</span>;
}

/**
 * A repertoire's, chapter's or player's progress (R-225, R-177): the bar,
 * then Mastered as Today's success pill (R-178), or one muted line: New
 * with the size while no own move is started (an "I know this" move is
 * started, R-151), or the share learned and the due count when above zero.
 * Nothing for a set without own moves.
 */
export function StandingLine({
  standing,
  due,
}: {
  readonly standing: Standing;
  readonly due: number;
}): JSX.Element | null {
  const percent = percentLearned(standing.counts);
  if (percent === null) return null;
  return (
    <span className="flex flex-col gap-1">
      <LearnedBar percent={percent} />
      {standing.mastered ? (
        <MasteredBadge />
      ) : (
        <StandingText standing={standing} percent={percent} due={due} />
      )}
    </span>
  );
}
