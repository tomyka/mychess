import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** The flags an assignment can show as badges (R-46, R-51, R-128, R-133). */
export interface BadgeFlags {
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly forked: boolean;
  readonly updated: boolean;
}

/** Each badge in the order it shows, with its colours. */
const BADGES = [
  ['overdue', 'bg-error-subtle text-error'],
  ['paused', 'bg-sunken text-fg'],
  ['forked', 'bg-learned-subtle text-learned'],
  ['updated', 'bg-accent text-accent-fg'],
] as const;

/**
 * An assignment's badges as one wrapping row; nothing when none is on.
 * What they mean is decided elsewhere (the domain's assignmentStatus).
 */
export function AssignmentBadges({
  flags,
}: {
  readonly flags: BadgeFlags;
}): JSX.Element | null {
  const t = useTranslations('assignment.badge');
  const on = BADGES.filter(([flag]) => flags[flag]);
  if (on.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {on.map(([flag, colours]) => (
        <li
          key={flag}
          className={`rounded-full px-2 py-0.5 text-sm font-semibold ${colours}`}
        >
          {t(flag)}
        </li>
      ))}
    </ul>
  );
}
