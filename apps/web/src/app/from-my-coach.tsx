import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { assignedRepertoirePath } from '../lib/routes';
import type { HomeAssignment } from '../server/assignment-pages';
import { AssignmentBadges } from './assignment-badges';
import { SECTION, SECTION_TITLE, TEXT_LINK } from './nustatymai/styles';
import { useDeadline } from './use-deadline';

/** One assignment: its page, who assigned it, the deadline and the badges. */
function AssignmentItem({
  assignment,
}: {
  readonly assignment: HomeAssignment;
}): JSX.Element {
  const t = useTranslations('assignment');
  const date = useDeadline();
  const { deadline } = assignment;
  return (
    <li className="flex flex-col gap-1">
      <Link
        href={assignedRepertoirePath(assignment.repertoireId)}
        className={`${TEXT_LINK} font-semibold`}
      >
        {assignment.name}
      </Link>
      <span className="text-fg-muted">
        {t('page.assignedBy', { name: assignment.coachName })}
      </span>
      {deadline === null ? null : (
        <span>{t('deadlineOn', { date: date(deadline) })}</span>
      )}
      <AssignmentBadges flags={assignment} />
    </li>
  );
}

/**
 * "From my coach" on home (R-15): each repertoire a coach assigned to the
 * player, with its overdue, paused and updated badges (R-51, R-46, R-133).
 * Not shown when there is none.
 */
export function FromMyCoach({
  assignments,
}: {
  readonly assignments: readonly HomeAssignment[];
}): JSX.Element | null {
  const t = useTranslations('assignment.home');
  const titleId = useId();
  if (assignments.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <ul className="flex flex-col gap-4">
        {assignments.map((assignment) => (
          <AssignmentItem
            key={assignment.repertoireId}
            assignment={assignment}
          />
        ))}
      </ul>
    </section>
  );
}
