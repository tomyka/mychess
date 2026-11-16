'use client';

import type { CoachAssignment, CoachAssignmentPlayer } from '@mychess/db';
import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import { AssignmentBadges } from '../../assignment-badges';
import { useDeadline } from '../../use-deadline';
import { DeadlineForms, Unassign } from './assignment-row-forms';

/** A row's own deadline, or that it has none. */
function RowDeadline({
  deadline,
}: {
  readonly deadline: string | null;
}): JSX.Element {
  const t = useTranslations('assignment');
  const date = useDeadline();
  return (
    <p className="text-sm text-fg-muted">
      {deadline === null
        ? t('noDeadline')
        : t('deadlineOn', { date: date(deadline) })}
    </p>
  );
}

/**
 * One player of a group row: their name and badges, and their own deadline
 * where it is not the group's (R-16: the join day moved it).
 */
function GroupPlayer({
  player,
  rowDeadline,
}: {
  readonly player: CoachAssignmentPlayer;
  readonly rowDeadline: string | null;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const date = useDeadline();
  const own = player.deadline === rowDeadline ? null : player.deadline;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{player.displayName}</span>
      {own === null ? null : (
        <span className="text-sm text-fg-muted">
          {t('playerDeadline', { date: date(own) })}
        </span>
      )}
      <AssignmentBadges flags={player.badges} />
    </li>
  );
}

/** Who an assignment reaches: one player's badges, or a group's players. */
function Reached({
  assignment,
}: {
  readonly assignment: CoachAssignment;
}): JSX.Element | null {
  const t = useTranslations('assignment.panel');
  if (assignment.target.kind === 'player') {
    const [player] = assignment.players;
    return player === undefined ? null : (
      <AssignmentBadges flags={player.badges} />
    );
  }
  if (assignment.players.length === 0)
    return <p className="text-sm text-fg-muted">{t('emptyGroup')}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {assignment.players.map((player) => (
        <GroupPlayer
          key={player.playerId}
          player={player}
          rowDeadline={assignment.deadline}
        />
      ))}
    </ul>
  );
}

/** One assignment: its target, deadline, players, and what can change. */
export function AssignmentRow({
  assignment,
}: {
  readonly assignment: CoachAssignment;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const nameId = useId();
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-col">
        {assignment.target.kind === 'group' ? (
          <span className="text-sm text-fg-muted">{t('group')}</span>
        ) : null}
        <h4 id={nameId} className="font-semibold">
          {assignment.target.name}
        </h4>
        <RowDeadline deadline={assignment.deadline} />
      </div>
      <Reached assignment={assignment} />
      <DeadlineForms assignment={assignment} describedBy={nameId} />
      <Unassign assignment={assignment} describedBy={nameId} />
    </li>
  );
}
