import { totalMoves, type Standing } from '@mychess/chess';
import type { CoachStatus, GroupProgressCell } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { MasteredBadge } from '../../../mastered-badge';
import { Pill, type PillTone } from '../../../pill';
import { useStatusPill } from '../../assignment-status-line';
import { standingHeadline } from '../../standing-headline';
import { StateBar } from '../../state-bar';

/** Which member and repertoire a cell is about, to name its link. */
export interface CellTarget {
  readonly href: string;
  readonly name: string;
  readonly repertoire: string;
}

/**
 * What a cell's link shows after its bar: one word in place of % and due
 * (a status pill, Not started, Nothing to learn), or % and the due count.
 */
type CellWords =
  | {
      readonly kind: 'word';
      readonly text: string;
      readonly tone: PillTone | null;
    }
  | { readonly kind: 'counts'; readonly percent: string; readonly due: number };

/**
 * The cell's words (spec, A group): the standing's headline, a status in
 * its pill, "Not started" as a neutral pill, or % learned and due.
 */
function useCellWords(standing: Standing, status: CoachStatus): CellWords {
  const t = useTranslations('coach.progress');
  const pill = useStatusPill();
  const headline = standingHeadline(standing.counts, status);
  switch (headline.kind) {
    case 'status': {
      const { word, tone } = pill(headline.flag);
      return { kind: 'word', text: word, tone };
    }
    case 'nothing':
      return { kind: 'word', text: t('nothing'), tone: null };
    case 'notStarted':
      return { kind: 'word', text: t('cellNotStarted'), tone: 'neutral' };
    case 'counts':
      return {
        kind: 'counts',
        percent: t('percent', { percent: headline.percent }),
        due: headline.counts.due,
      };
  }
}

/** The link's name: the member and the repertoire around its visible text. */
function useCellLabel(words: CellWords, target: CellTarget): string {
  const t = useTranslations('coach.progress');
  const who = { name: target.name, repertoire: target.repertoire };
  return words.kind === 'word'
    ? t('cellLabelNothing', { ...who, nothing: words.text })
    : t('cellLabel', {
        ...who,
        percent: words.percent,
        due: t('cellDue', { due: words.due }),
      });
}

/** What follows the bar: the word (in its pill), or % and the due count. */
function Words({ words }: { readonly words: CellWords }): JSX.Element {
  const t = useTranslations('coach.progress');
  if (words.kind === 'counts')
    return (
      <>
        <span>{words.percent}</span>
        {words.due > 0 ? (
          <span className="text-due">{t('cellDue', { due: words.due })}</span>
        ) : null}
      </>
    );
  return words.tone === null ? (
    <span>{words.text}</span>
  ) : (
    <Pill tone={words.tone}>{words.text}</Pill>
  );
}

/**
 * The 6px bar and the cell's words: a link to the member's progress on
 * the repertoire, named for WCAG 2.5.3.
 */
function CellLink({
  cell,
  standing,
  target,
}: {
  readonly cell: GroupProgressCell;
  readonly standing: Standing;
  readonly target: CellTarget;
}): JSX.Element {
  const words = useCellWords(standing, cell.status);
  return (
    <Link
      href={target.href}
      aria-label={useCellLabel(words, target)}
      className="inline-flex min-h-touch items-center gap-2 text-accent underline"
    >
      {totalMoves(standing.counts) === 0 ? null : (
        <span className="w-12 shrink-0">
          <StateBar counts={standing.counts} size="row" />
        </span>
      )}
      <Words words={words} />
    </Link>
  );
}

/**
 * One member's standing on one group repertoire, the same in the phone
 * line and the grid cell (spec, A group): "Not assigned"; a forked
 * assignment's badge alone (R-155); or the link to their progress, with
 * Mastered beside it (R-178).
 */
export function GroupCell({
  cell,
  target,
}: {
  readonly cell: GroupProgressCell | null;
  readonly target: CellTarget;
}): JSX.Element {
  const t = useTranslations();
  if (cell === null)
    return (
      <span className="text-sm text-fg-muted">
        {t('coach.progress.noAssignment')}
      </span>
    );
  const { view } = cell;
  if (view.kind === 'forked')
    return <Pill tone="neutral">{t('assignment.badge.forked')}</Pill>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <CellLink cell={cell} standing={view.standing} target={target} />
      {view.standing.mastered ? <MasteredBadge /> : null}
    </span>
  );
}
