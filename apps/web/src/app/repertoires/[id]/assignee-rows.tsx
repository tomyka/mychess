'use client';

import type { Standing } from '@mychess/chess';
import type { CoachAssignment, CoachAssignmentPlayer } from '@mychess/db';
import { useTranslations } from 'next-intl';
import { useId, useState, type JSX } from 'react';
import { AssignmentBadges } from '../../assignment-badges';
import { SECONDARY_BUTTON } from '../../buttons';
import { StandingLine } from '../../standing-line';
import { useShortDeadline } from '../../use-deadline';
import { DeadlineForms, Unassign } from './assignment-row-forms';

/**
 * One row: a player an assignment reaches, or, for a group without
 * players, the group itself (so it can still be changed or unassigned).
 */
interface Assignee {
  readonly key: string;
  readonly assignment: CoachAssignment;
  readonly player: CoachAssignmentPlayer | null;
}

/** Each assignment's players, in order, as rows. */
function assigneesOf(assignments: readonly CoachAssignment[]): Assignee[] {
  return assignments.flatMap((assignment): Assignee[] =>
    assignment.players.length === 0
      ? [{ key: assignment.id, assignment, player: null }]
      : assignment.players.map((player) => ({
          key: `${assignment.id}:${player.playerId}`,
          assignment,
          player,
        })),
  );
}

/** The player's own deadline, short ("due Nov 30"), or that it has none. */
function RowDeadline({
  deadline,
  today,
}: {
  readonly deadline: string | null;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment');
  const date = useShortDeadline(today);
  return (
    <span>
      {deadline === null
        ? t('noDeadline')
        : t('panel.due', { date: date(deadline) })}
    </span>
  );
}

/** The muted line under the name: the group it comes through, if any. */
function GroupLine({
  id,
  assignee,
}: {
  readonly id: string;
  readonly assignee: Assignee;
}): JSX.Element | null {
  const t = useTranslations('assignment.panel');
  const { assignment, player } = assignee;
  if (player === null) return <span>{t('emptyGroup')}</span>;
  if (assignment.target.kind !== 'group') return null;
  return <span id={id}>{t('inGroup', { name: assignment.target.name })}</span>;
}

/**
 * At the top of a group's opened forms: the group's own deadline, which
 * they edit, as the row shows the player's (R-16).
 */
function GroupDeadline({
  deadline,
  today,
}: {
  readonly deadline: string | null;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const date = useShortDeadline(today);
  return (
    <p className="text-fg">
      {deadline === null
        ? t('groupNoDeadline')
        : t('groupDeadline', { date: date(deadline) })}
    </p>
  );
}

/** The Change button's label: a group's names the group it changes. */
function useChangeLabel(assignment: CoachAssignment): string {
  const t = useTranslations('assignment.panel');
  return assignment.target.kind === 'group'
    ? t('changeFor', { name: assignment.target.name })
    : t('change');
}

/**
 * Change: opens the assignment's deadline and Unassign in the row. In a
 * group's row they change the group's assignment, which the button names
 * and whose deadline the forms start with.
 */
function RowChange({
  assignment,
  describedBy,
  today,
}: {
  readonly assignment: CoachAssignment;
  readonly describedBy: string;
  readonly today: string;
}): JSX.Element {
  const label = useChangeLabel(assignment);
  const [open, setOpen] = useState(false);
  const formsId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={formsId}
        aria-describedby={describedBy}
        onClick={() => {
          setOpen(!open);
        }}
        className={`${SECONDARY_BUTTON} self-start sm:ml-auto`}
      >
        {label}
      </button>
      <div
        id={formsId}
        hidden={!open}
        className="flex basis-full flex-col gap-3"
      >
        {open ? (
          <>
            {assignment.target.kind === 'group' ? (
              <GroupDeadline deadline={assignment.deadline} today={today} />
            ) : null}
            <DeadlineForms
              assignment={assignment}
              describedBy={describedBy}
              today={today}
            />
            <Unassign assignment={assignment} describedBy={describedBy} />
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * One player's row: the name and their progress (R-225; none on their own
 * copy, R-155), then the group, deadline, badges and Change.
 */
function AssigneeRow({
  assignee,
  standing,
  today,
}: {
  readonly assignee: Assignee;
  readonly standing: Standing | null;
  readonly today: string;
}): JSX.Element {
  const nameId = useId();
  const groupId = useId();
  const { assignment, player } = assignee;
  const throughGroup = assignment.target.kind === 'group' && player !== null;
  return (
    <li
      aria-labelledby={nameId}
      className="flex flex-col gap-1 border-t border-border py-3"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <span id={nameId} className="font-semibold sm:flex-1">
          {player?.displayName ?? assignment.target.name}
        </span>
        {standing === null ? null : (
          <span className="sm:w-56">
            {/* The learned share only (R-225): no due count for the coach. */}
            <StandingLine standing={standing} due={0} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
        <GroupLine id={groupId} assignee={assignee} />
        <RowDeadline
          deadline={player?.deadline ?? assignment.deadline}
          today={today}
        />
        {player === null ? null : <AssignmentBadges flags={player.badges} />}
        <RowChange
          assignment={assignment}
          describedBy={throughGroup ? groupId : nameId}
          today={today}
        />
      </div>
    </li>
  );
}

/**
 * Whom the coach's repertoire is assigned to (R-225, R-226): one compact
 * row per player, a group's players each on their own row.
 */
export function AssigneeRows({
  assignments,
  standings,
  today,
}: {
  readonly assignments: readonly CoachAssignment[];
  /** Each player's standing, null where the coach sees none (R-155). */
  readonly standings: ReadonlyMap<string, Standing | null>;
  /** The earliest deadline the date field offers (R-203). */
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const rows = assigneesOf(assignments);
  if (rows.length === 0) return <p className="text-fg-muted">{t('none')}</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((assignee) => (
        <AssigneeRow
          key={assignee.key}
          assignee={assignee}
          standing={
            assignee.player === null
              ? null
              : (standings.get(assignee.player.playerId) ?? null)
          }
          today={today}
        />
      ))}
    </ul>
  );
}
