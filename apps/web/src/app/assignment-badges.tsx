import type { BadgeSet } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { pillClass } from './pill';

/** Each badge in the order it shows, with its pill tone. */
const BADGES = [
  ['overdue', 'overdue'],
  ['paused', 'neutral'],
  ['forked', 'neutral'],
  ['updated', 'updated'],
] as const;

/**
 * An assignment's badges as one wrapping row; nothing when none is on.
 * Which are on is decided by the domain (assignmentBadges).
 */
export function AssignmentBadges({
  flags,
}: {
  readonly flags: BadgeSet;
}): JSX.Element | null {
  const t = useTranslations('assignment.badge');
  const on = BADGES.filter(([flag]) => flags[flag]);
  if (on.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {on.map(([flag, tone]) => (
        <li key={flag} className={pillClass(tone)}>
          {t(flag)}
        </li>
      ))}
    </ul>
  );
}
