import type { GroupAssignment } from '@mychess/db';
import { nearestAssignment } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { useShortDeadline } from '../use-deadline';

/**
 * A group's meta line: "6 players · Slav Defence due Nov 30 · +2 more".
 * It names one assignment, the nearest deadline's, so it stays within two
 * lines (height budget, docs/design/coach-shared-repertoire.md); the
 * group page lists every one. `today` is the loader's Vilnius day.
 */
export function GroupMeta({
  memberCount,
  assignments,
  today,
}: {
  readonly memberCount: number;
  readonly assignments: readonly GroupAssignment[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const date = useShortDeadline(today);
  const first = nearestAssignment(assignments);
  const parts = [t('groups.members', { count: memberCount })];
  if (first !== undefined)
    parts.push(
      first.deadline === null
        ? first.repertoireName
        : t('groups.assignmentDue', {
            name: first.repertoireName,
            date: date(first.deadline),
          }),
    );
  if (assignments.length > 1)
    parts.push(t('groups.more', { count: assignments.length - 1 }));
  return (
    <span className="text-sm text-fg-muted">
      {parts.join(t('progress.separator'))}
    </span>
  );
}
