import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { assignedRepertoirePath } from '../lib/routes';
import type { AssignedListItem } from '../server/assignment-pages';
import { AssignmentFacts } from './assignment-facts';
import { SECTION, SECTION_TITLE } from './nustatymai/styles';

/**
 * The repertoire's name as a link one text line high, so the lines under
 * it sit at the same gap as each other; its hit area still reaches 44px
 * (24px line + 10px above and below).
 */
const ITEM_LINK =
  "relative self-start font-semibold text-accent underline after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']";

/** One assignment: its page, who assigned it, the deadline and the badges. */
function AssignmentItem({
  assignment,
}: {
  readonly assignment: AssignedListItem;
}): JSX.Element {
  return (
    <li className="flex flex-col gap-1">
      <Link
        href={assignedRepertoirePath(assignment.repertoireId)}
        className={ITEM_LINK}
      >
        {assignment.name}
      </Link>
      <AssignmentFacts assignment={assignment} className="gap-1" />
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
  readonly assignments: readonly AssignedListItem[];
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
