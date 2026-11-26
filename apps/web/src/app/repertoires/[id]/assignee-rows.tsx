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

/** Each player's standing, null where the coach sees none (R-155). */
type Standings = ReadonlyMap<string, Standing | null>;

const ROW = 'flex flex-col gap-1 border-t border-border py-3';
const NAME_LINE = 'flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4';
const FACTS =
  'flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted';

/** A deadline, short ("due Nov 30"), or that there is none. */
function useDeadlineText(today: string): (deadline: string | null) => string {
  const t = useTranslations('assignment');
  const date = useShortDeadline(today);
  return (deadline) =>
    deadline === null
      ? t('noDeadline')
      : t('panel.due', { date: date(deadline) });
}

/**
 * Change: opens the assignment's deadline and Unassign in its row, under
 * the row's line. `describedBy` names whom they act for: the player, or
 * the group.
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
  const t = useTranslations('assignment.panel');
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
        {t('change')}
      </button>
      <div
        id={formsId}
        hidden={!open}
        className="flex basis-full flex-col gap-3"
      >
        {open ? (
          <>
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

/** The name, and the player's progress beside it (R-225; none on their own copy, R-155). */
function NameLine({
  id,
  name,
  standing,
}: {
  readonly id: string;
  readonly name: string;
  readonly standing: Standing | null;
}): JSX.Element {
  return (
    <div className={NAME_LINE}>
      <span id={id} className="font-semibold sm:flex-1">
        {name}
      </span>
      {standing === null ? null : (
        <span className="sm:w-56">
          {/* The learned share only (R-225): no due count for the coach. */}
          <StandingLine standing={standing} due={0} />
        </span>
      )}
    </div>
  );
}

/**
 * A player's own assignment: the name and progress, then the deadline,
 * badges and Change.
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
  const deadline = useDeadlineText(today);
  const player = assignment.players[0];
  return (
    <li aria-labelledby={nameId} className={ROW}>
      <NameLine
        id={nameId}
        name={player?.displayName ?? assignment.target.name}
        standing={
          player === undefined ? null : (standings.get(player.playerId) ?? null)
        }
      />
      <div className={FACTS}>
        <span>{deadline(player?.deadline ?? assignment.deadline)}</span>
        {player === undefined ? null : (
          <AssignmentBadges flags={player.badges} />
        )}
        <RowChange assignment={assignment} describedBy={nameId} today={today} />
      </div>
    </li>
  );
}

/**
 * A member under a group's row: the name and progress, the badges, and the
 * member's own deadline where it is not the group's (R-16: a later join
 * moves it). The group's Change acts for them.
 */
function MemberRow({
  player,
  groupDeadline,
  standing,
  today,
}: {
  readonly player: CoachAssignmentPlayer;
  readonly groupDeadline: string | null;
  readonly standing: Standing | null;
  readonly today: string;
}): JSX.Element {
  const nameId = useId();
  const deadline = useDeadlineText(today);
  return (
    <li aria-labelledby={nameId} className="flex flex-col gap-1 py-2">
      <NameLine id={nameId} name={player.displayName} standing={standing} />
      <div className={FACTS}>
        {player.deadline === groupDeadline ? null : (
          <span>{deadline(player.deadline)}</span>
        )}
        <AssignmentBadges flags={player.badges} />
      </div>
    </li>
  );
}

/**
 * A group's assignment as one row (sign-off #381 part 4): its name, "3
 * players · due Dec 20" and the one Change for the group, then its members'
 * progress rows under it.
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
  const deadline = useDeadlineText(today);
  const { players } = assignment;
  return (
    <li aria-labelledby={nameId} className={ROW}>
      <span id={nameId} className="font-semibold">
        {assignment.target.name}
      </span>
      <div className={FACTS}>
        <span>
          {t('groupFacts', {
            count: players.length,
            deadline: deadline(assignment.deadline),
          })}
        </span>
        <RowChange assignment={assignment} describedBy={nameId} today={today} />
      </div>
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
              standing={standings.get(player.playerId) ?? null}
              today={today}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Whom the coach's repertoire is assigned to (R-225, R-226): a row per
 * assignment. A player's own has its own row and Change; a group's is one
 * row with one Change and its members' progress under it. A player who has
 * it both ways shows in both.
 */
export function AssigneeRows({
  assignments,
  standings,
  today,
}: {
  readonly assignments: readonly CoachAssignment[];
  /** Each player's standing, null where the coach sees none (R-155). */
  readonly standings: Standings;
  /** The earliest deadline the date field offers (R-203). */
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
