'use client';

import type {
  AssigneeStanding,
  CoachAssignment,
  CoachAssignmentPlayer,
} from '@mychess/db';
import { useTranslations } from 'next-intl';
import { useId, useState, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../../buttons';
import { DeadlineLine } from '../../coach/assignment-status-line';
import { AssigneeRow, RowHeader } from './assignee-row';
import { DeadlineForms, Unassign } from './assignment-row-forms';

/** Each player's standing and status, null where the coach sees none (R-155). */
type Standings = ReadonlyMap<string, AssigneeStanding | null>;

/** Whether a row's Change is open, and the id of what it opens. */
interface Disclosure {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly panelId: string;
}

function useDisclosure(): Disclosure {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return {
    open,
    toggle: () => {
      setOpen(!open);
    },
    panelId,
  };
}

/** Change, beside the row's name; `describedBy` names whom it acts for. */
function ChangeButton({
  change,
  describedBy,
}: {
  readonly change: Disclosure;
  readonly describedBy: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  return (
    <button
      type="button"
      aria-expanded={change.open}
      aria-controls={change.panelId}
      aria-describedby={describedBy}
      onClick={change.toggle}
      className={SECONDARY_BUTTON}
    >
      {t('change')}
    </button>
  );
}

/**
 * What Change opens in its row: the deadline, then, set apart, Unassign
 * (spec, Assignments on the Repertoire screen).
 */
function ChangePanel({
  change,
  assignment,
  describedBy,
  today,
}: {
  readonly change: Disclosure;
  readonly assignment: CoachAssignment;
  readonly describedBy: string;
  readonly today: string;
}): JSX.Element {
  return (
    <div
      id={change.panelId}
      hidden={!change.open}
      className="flex flex-col gap-4 rounded-control bg-sunken p-3"
    >
      {change.open ? (
        <>
          <DeadlineForms
            assignment={assignment}
            describedBy={describedBy}
            today={today}
          />
          <div className="border-t border-border pt-3">
            <Unassign assignment={assignment} describedBy={describedBy} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A player's own assignment: their row, with Change. Its row exists only
 * while the coach is linked to them (assignments_link_fk), so it always
 * reaches them; were it not to, the row is the name and Change alone.
 */
function PlayerRow({
  assignment,
  standings,
  today,
}: {
  readonly assignment: CoachAssignment;
  readonly standings: Standings;
  readonly today: string;
}): JSX.Element {
  const nameId = useId();
  const change = useDisclosure();
  const [player] = assignment.players;
  const action = <ChangeButton change={change} describedBy={nameId} />;
  const panel = (
    <ChangePanel
      change={change}
      assignment={assignment}
      describedBy={nameId}
      today={today}
    />
  );
  if (player === undefined)
    return (
      <li
        aria-labelledby={nameId}
        className="flex flex-col gap-2 border-t border-border py-3"
      >
        <RowHeader
          nameId={nameId}
          name={assignment.target.name}
          action={action}
        />
        {panel}
      </li>
    );
  return (
    <AssigneeRow
      nameId={nameId}
      name={player.displayName}
      player={player}
      shown={standings.get(player.playerId) ?? null}
      today={today}
      divided
      action={action}
    >
      {panel}
    </AssigneeRow>
  );
}

/**
 * A group's assignment as one row: its name and deadline, the one Change
 * for the group, then its members' rows under it, each with the member's
 * own deadline where it is not the group's (R-16: a later join moves it).
 */
function GroupRow({
  assignment,
  standings,
  today,
}: {
  readonly assignment: CoachAssignment;
  readonly standings: Standings;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const nameId = useId();
  const change = useDisclosure();
  const { players } = assignment;
  return (
    <li
      aria-labelledby={nameId}
      className="flex flex-col gap-2 border-t border-border py-3"
    >
      <RowHeader
        nameId={nameId}
        name={assignment.target.name}
        action={<ChangeButton change={change} describedBy={nameId} />}
      />
      <DeadlineLine deadline={assignment.deadline} today={today} />
      <ChangePanel
        change={change}
        assignment={assignment}
        describedBy={nameId}
        today={today}
      />
      {players.length === 0 ? null : (
        <ul
          aria-label={t('groupMembers', { name: assignment.target.name })}
          className="flex flex-col border-l-2 border-border pl-4"
        >
          {players.map((player) => (
            <MemberRow
              key={player.playerId}
              player={player}
              groupDeadline={assignment.deadline}
              shown={standings.get(player.playerId) ?? null}
              today={today}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A member under a group's row; the group's Change acts for them. */
function MemberRow({
  player,
  groupDeadline,
  shown,
  today,
}: {
  readonly player: CoachAssignmentPlayer;
  readonly groupDeadline: string | null;
  readonly shown: AssigneeStanding | null;
  readonly today: string;
}): JSX.Element {
  const nameId = useId();
  return (
    <AssigneeRow
      nameId={nameId}
      name={player.displayName}
      player={player}
      shown={shown}
      today={today}
      groupDeadline={groupDeadline}
    />
  );
}

/**
 * Whom the coach's repertoire is assigned to (R-225, R-226, R-231): a row
 * per assignment. A player's own has its own row and Change; a group's is
 * one row with one Change and its members' rows under it. A player who has
 * it both ways shows in both.
 */
export function AssigneeRows({
  assignments,
  standings,
  today,
}: {
  readonly assignments: readonly CoachAssignment[];
  /** Each player's standing and status, null where the coach sees none (R-155). */
  readonly standings: Standings;
  /** Today in Vilnius: the date fields' earliest day (R-203). */
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  if (assignments.length === 0)
    return <p className="text-fg-muted">{t('none')}</p>;
  return (
    <ul className="flex flex-col">
      {assignments.map((assignment) =>
        assignment.target.kind === 'group' ? (
          <GroupRow
            key={assignment.id}
            assignment={assignment}
            standings={standings}
            today={today}
          />
        ) : (
          <PlayerRow
            key={assignment.id}
            assignment={assignment}
            standings={standings}
            today={today}
          />
        ),
      )}
    </ul>
  );
}
