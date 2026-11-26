import type { BadgeSet } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * Each badge in the order it shows, with its colours. Every badge has a
 * border so all are one height; the neutral ones show it, as `sunken` alone
 * is the page colour on a phone. `learned` and `due` stay the progress
 * colours (docs/design/README.md), so "forked" and "paused" are neutral:
 * an outline and muted text, without a fill, which with the strong border
 * and full text colour made Paused look like a button (#381 part 4).
 */
const NEUTRAL = 'border-border-strong text-fg-muted';

const BADGES = [
  ['overdue', 'border-transparent bg-error-subtle text-error'],
  ['paused', NEUTRAL],
  ['forked', NEUTRAL],
  ['updated', 'border-transparent bg-accent text-accent-fg'],
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
      {on.map(([flag, colours]) => (
        <li
          key={flag}
          className={`rounded-pill border px-2 py-0.5 text-sm font-semibold ${colours}`}
        >
          {t(flag)}
        </li>
      ))}
    </ul>
  );
}
