import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { AssignedListItem } from '../server/assignment-pages';
import { AssignmentBadges } from './assignment-badges';
import { useDeadline } from './use-deadline';

/**
 * What an assignment shows under its name wherever it is listed (home's
 * "From my coach", My repertoires): who assigned it and its deadline, in
 * one block that `id` names (for a link's aria-describedby), then its
 * badges (R-51, R-46, R-133). `className` styles the text block.
 */
export function AssignmentFacts({
  assignment,
  id,
  className = '',
}: {
  readonly assignment: Pick<
    AssignedListItem,
    'coachName' | 'deadline' | 'badges'
  >;
  readonly id?: string;
  readonly className?: string;
}): JSX.Element {
  const t = useTranslations('assignment');
  const date = useDeadline();
  const { deadline } = assignment;
  return (
    <>
      <span id={id} className={`flex flex-col ${className}`}>
        <span className="text-fg-muted">
          {t('page.assignedBy', { name: assignment.coachName })}
        </span>
        {deadline === null ? null : (
          <span>{t('deadlineOn', { date: date(deadline) })}</span>
        )}
      </span>
      <AssignmentBadges flags={assignment.badges} />
    </>
  );
}
