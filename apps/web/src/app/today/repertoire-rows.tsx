import { percentLearned } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import {
  assignedRepertoirePath,
  repertoireRoute,
  trainingPath,
} from '../../lib/routes';
import type { TodayPageRow } from '../../server/today-page';
import { AssignmentFacts } from '../assignment-facts';
import { MasteredBadge } from '../coach/state-bar';
import { CARD } from '../surfaces';
import { LearnedBar } from './learned-bar';

/**
 * The repertoire's name as a link one text line high, so the lines under
 * it sit at the same gap as each other; its hit area still reaches 44px
 * (24px line + 10px above and below). It wraps, never truncates.
 */
const NAME_LINK =
  "relative min-w-0 break-words font-semibold text-accent underline after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']";

/** The row's own action: a secondary control, a 44px target. */
const ROW_BUTTON =
  'inline-flex min-h-touch shrink-0 items-center justify-center rounded-control bg-accent-subtle px-4 py-2 font-semibold text-accent';

/**
 * The row's action as todayRows decided it (R-221): Review N, Learn, or
 * nothing. Described by the row's name: "Review 8, Sicilian Najdorf".
 */
function RowAction({
  row,
  describedBy,
}: {
  readonly row: TodayPageRow;
  readonly describedBy: string;
}): JSX.Element | null {
  const t = useTranslations('today');
  if (row.action === null) return null;
  return (
    <Link
      href={trainingPath(row.action, row.repertoireId)}
      aria-describedby={describedBy}
      className={ROW_BUTTON}
    >
      {row.action === 'review' ? t('review', { count: row.due }) : t('learn')}
    </Link>
  );
}

/** The bar and "N% learned" (R-177), then Mastered (R-178); none without moves. */
function Progress({ row }: { readonly row: TodayPageRow }): JSX.Element | null {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(row.standing.counts);
  if (percent === null) return null;
  return (
    <span className="flex flex-col gap-1">
      <LearnedBar percent={percent} />
      <span className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        {t('percent', { percent })}
        {row.standing.mastered ? <MasteredBadge /> : null}
      </span>
    </span>
  );
}

/** One repertoire: its name and side, an assignment's facts, progress, action. */
function RepertoireRow({ row }: { readonly row: TodayPageRow }): JSX.Element {
  const t = useTranslations('repertoires.create');
  const nameId = useId();
  const href =
    row.kind === 'assigned'
      ? assignedRepertoirePath(row.repertoireId)
      : repertoireRoute(row.repertoireId);
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-b-0">
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <Link id={nameId} href={href} className={NAME_LINK}>
            {row.name}
          </Link>
          <span className="text-sm text-fg-muted">{t(row.side)}</span>
        </span>
        {row.assignment === null ? null : (
          <AssignmentFacts
            assignment={row.assignment}
            className="gap-1 text-sm"
          />
        )}
        <Progress row={row} />
      </span>
      <RowAction row={row} describedBy={nameId} />
    </li>
  );
}

/**
 * Today's list of every repertoire the player trains, own and assigned
 * (R-221, R-222), in the order the rows come: due ones first (R-207), then
 * the learn order (R-145).
 */
export function RepertoireRows({
  rows,
}: {
  readonly rows: readonly TodayPageRow[];
}): JSX.Element {
  const t = useTranslations('today');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`${CARD} flex flex-col gap-2 p-5`}
    >
      <h2 id={titleId} className="text-xl font-bold">
        {t('repertoires')}
      </h2>
      <ul>
        {rows.map((row) => (
          <RepertoireRow key={row.repertoireId} row={row} />
        ))}
      </ul>
    </section>
  );
}
