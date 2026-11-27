'use client';

import type { AssigneeStanding, CoachAssignmentPlayer } from '@mychess/db';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { AssignmentStatusLine } from '../../coach/assignment-status-line';
import { ProgressCounts } from '../../coach/progress-counts';
import { StateBar } from '../../coach/state-bar';

/**
 * The player's progress (R-231): the 6px bar and "% learned" with the due
 * count; "Own copy" for a fork, which shows the coach no progress (R-155);
 * nothing where the coach is shown none.
 */
function RowProgress({
  forked,
  shown,
}: {
  readonly forked: boolean;
  readonly shown: AssigneeStanding | null;
}): JSX.Element | null {
  const t = useTranslations('coach.progress');
  if (forked) return <p className="text-sm text-fg-muted">{t('tag.fork')}</p>;
  if (shown === null) return null;
  const { counts, mastered } = shown.standing;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="sm:w-40">
        <StateBar counts={counts} size="row" />
      </div>
      <ProgressCounts counts={counts} mastered={mastered} />
    </div>
  );
}

/** A row's first line: the name, which labels the row, and its action. */
export function RowHeader({
  nameId,
  name,
  action,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id={nameId} className="flex-1 font-semibold">
        {name}
      </span>
      {action}
    </div>
  );
}

/**
 * A player's row under "Assigned to" (R-225, R-231): the name with the
 * row's action (Change) beside it, the progress, the deadline and status
 * pills, then whatever the action opens. The status is the progress read's
 * where the coach is shown one, else the assignment read's: both are the
 * domain's (R-129). A group's member has no action, and leaves out a
 * deadline that is the group's.
 */
export function AssigneeRow({
  nameId,
  name,
  player,
  shown,
  today,
  groupDeadline,
  divided = false,
  action,
  children,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly player: CoachAssignmentPlayer;
  /** The player's standing and status; null where the coach sees none. */
  readonly shown: AssigneeStanding | null;
  /** Today in Vilnius, from the loader. */
  readonly today: string;
  /** The deadline of the group's row this member is under; none for a player's own. */
  readonly groupDeadline?: string | null;
  /** A rule above it, as between the list's rows; none under a group. */
  readonly divided?: boolean;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}): JSX.Element {
  const status = shown?.status ?? player.status;
  const groupSaysIt =
    groupDeadline !== undefined && status.deadline === groupDeadline;
  return (
    <li
      aria-labelledby={nameId}
      className={`flex flex-col gap-2 py-3 ${divided ? 'border-t border-border' : ''}`}
    >
      <RowHeader nameId={nameId} name={name} action={action} />
      <RowProgress forked={status.forked} shown={shown} />
      <AssignmentStatusLine
        status={status}
        today={today}
        wording="deadline"
        parts={groupSaysIt ? 'pills' : 'all'}
      />
      {children}
    </li>
  );
}
