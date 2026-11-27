import type { GroupColumn } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { repertoireManageRoute } from '../../../../lib/routes';
import { SECTION_TITLE } from '../../../settings/styles';
import { CARD } from '../../../surfaces';
import { useShortDeadline } from '../../../use-deadline';
import { ROW_LINK } from '../../row-link';

/** One assignment: its name to its Repertoire screen, its deadline and done count. */
function AssignedRow({
  column,
  today,
}: {
  readonly column: GroupColumn;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const date = useShortDeadline(today);
  const deadline =
    column.deadline === null
      ? t('status.noDeadline')
      : t('group.assignedDue', { date: date(column.deadline) });
  return (
    <li className="relative flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
      <Link href={repertoireManageRoute(column.id)} className={ROW_LINK}>
        {column.name}
      </Link>
      <span className="text-sm text-fg-muted">
        {[
          deadline,
          t('group.doneOf', { done: column.done, count: column.count }),
        ].join(t('progress.separator'))}
      </span>
    </li>
  );
}

/**
 * What the coach assigned to the group (spec, A group): each repertoire,
 * its deadline and how many of the members holding it live are done, as
 * the read counts them (R-155); a row opens the repertoire's Repertoire
 * screen, where assigning is changed. Nothing when nothing is assigned:
 * the Progress section says so.
 */
export function AssignedSection({
  columns,
  today,
  className,
}: {
  readonly columns: readonly GroupColumn[];
  readonly today: string;
  readonly className: string;
}): JSX.Element | null {
  const t = useTranslations('coach.group');
  const titleId = useId();
  if (columns.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className={className}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('assignedTitle')}
      </h2>
      <ul className={`${CARD} flex flex-col px-4 py-1`}>
        {columns.map((column) => (
          <AssignedRow key={column.id} column={column} today={today} />
        ))}
      </ul>
    </section>
  );
}
