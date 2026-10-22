'use client';

import type { CoachAssignment, CoachAssignmentPlayer } from '@mychess/db';
import { assignmentBadges, FORK_OFFER_DAYS } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { targetField } from '../../../lib/assign-target';
import type { AssignPanelData } from '../../../server/coach-assignments';
import { AssignmentBadges } from '../../assignment-badges';
import { SECONDARY_BUTTON } from '../../buttons';
import { ConfirmedAction } from '../../confirmed-action';
import { PANEL_LABEL } from '../../repertoire-view';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { RefusalLine } from '../../treneris/refusal-line';
import { useDeadline } from '../../use-deadline';
import { useLatestAction } from '../../use-latest-action';
import {
  assignAction,
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
  type AssignmentActionState,
} from './assign-actions';

const FIELD =
  'min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error';

const INITIAL: AssignmentActionState = {};

/** A refusal, else `saved` once the form has saved; null before. */
function useOutcome(
  state: AssignmentActionState,
  saved: string,
): { text: string | null; tone: 'success' | 'error' } {
  const t = useTranslations();
  if (state.refusal !== undefined)
    return { text: t(state.refusal), tone: 'error' };
  return { text: state.saved === undefined ? null : saved, tone: 'success' };
}

/** Whom the picker offers: those it is not yet assigned to (the loader's). */
type Offer = Pick<AssignPanelData, 'players' | 'groups'>;

/** The badges a coach sees on one player (assignmentBadges). */
const coachBadges = ({ overdue, paused, forked }: CoachAssignmentPlayer) =>
  assignmentBadges({ audience: 'coach', overdue, paused, forked });

/** The picker: the players, then the groups, each under its label. */
function TargetSelect({
  id,
  players,
  groups,
  invalid,
}: Offer & {
  readonly id: string;
  readonly invalid: boolean;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  return (
    <select
      id={id}
      name="target"
      defaultValue=""
      aria-invalid={invalid ? true : undefined}
      className={FIELD}
    >
      <option value="">{t('choose')}</option>
      {players.length === 0 ? null : (
        <optgroup label={t('players')}>
          {players.map((player) => (
            <option key={player.id} value={targetField('player', player.id)}>
              {player.displayName}
            </option>
          ))}
        </optgroup>
      )}
      {groups.length === 0 ? null : (
        <optgroup label={t('groups')}>
          {groups.map((group) => (
            <option key={group.id} value={targetField('group', group.id)}>
              {group.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** Pick a player or a group and an optional deadline, then Assign. */
function AssignForm({
  repertoireId,
  offer,
  assigning,
}: {
  readonly repertoireId: string;
  readonly offer: Offer;
  readonly assigning: Assigning;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const targetId = useId();
  const dateId = useId();
  const [state, action, pending] = assigning;
  return (
    <>
      {/* Keyed by the saves, so it comes back empty after each. */}
      <form
        key={state.saved ?? 0}
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="repertoireId" value={repertoireId} />
        <label htmlFor={targetId} className="font-medium">
          {t('target')}
        </label>
        <TargetSelect
          id={targetId}
          {...offer}
          invalid={state.refusal !== undefined}
        />
        <label htmlFor={dateId} className="font-medium">
          {t('deadline')}
        </label>
        <input id={dateId} type="date" name="deadline" className={FIELD} />
        <button
          type="submit"
          disabled={pending}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('assign')}
        </button>
      </form>
    </>
  );
}

/** The assign action's state, dispatch and pending flag (useActionState). */
type Assigning = ReturnType<typeof useAssigning>;

const useAssigning = () => useActionState(assignAction, INITIAL);

/** The form, or why there is no one to offer; under it, the last outcome. */
function AssignNew({
  repertoireId,
  data,
}: {
  readonly repertoireId: string;
  readonly data: AssignPanelData;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const assigning = useAssigning();
  const outcome = useOutcome(assigning[0], t('assigned'));
  return (
    <>
      {data.players.length + data.groups.length > 0 ? (
        <AssignForm
          repertoireId={repertoireId}
          offer={data}
          assigning={assigning}
        />
      ) : (
        // Assigned to someone and no one left: it is everyone's already.
        <p className="text-fg-muted">
          {data.assignments.length === 0 ? t('nobody') : t('everyone')}
        </p>
      )}
      {/* Here, not in the form, so "Assigned" stays once the last target
          is taken and the form goes. */}
      <StatusLine text={outcome.text} tone={outcome.tone} />
    </>
  );
}

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
      <AssignmentBadges flags={coachBadges(player)} />
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
      <AssignmentBadges flags={coachBadges(player)} />
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

/** Change the row's deadline, or clear it while there is one (R-51). */
function DeadlineForms({
  assignment,
  describedBy,
}: {
  readonly assignment: CoachAssignment;
  readonly describedBy: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const dateId = useId();
  const { state, pending, using } = useLatestAction(INITIAL);
  const outcome = useOutcome(state, t('deadlineSaved'));
  return (
    <div className="flex flex-col gap-2">
      <form
        key={assignment.deadline ?? ''}
        noValidate
        onSubmit={submitByHand(using(setDeadlineAction))}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor={dateId} className="text-sm font-medium">
            {t('newDeadline')}
          </label>
          <input
            id={dateId}
            type="date"
            name="deadline"
            defaultValue={assignment.deadline ?? ''}
            className={FIELD}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-describedby={describedBy}
          className={SECONDARY_BUTTON}
        >
          {t('changeDeadline')}
        </button>
      </form>
      {assignment.deadline === null ? null : (
        <form onSubmit={submitByHand(using(clearDeadlineAction))}>
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <button
            type="submit"
            disabled={pending}
            aria-describedby={describedBy}
            className={SECONDARY_BUTTON}
          >
            {t('clearDeadline')}
          </button>
        </form>
      )}
      <StatusLine text={outcome.text} tone={outcome.tone} />
    </div>
  );
}

/** Unassign behind a confirm that says what the players keep (R-130). */
function Unassign({
  assignment,
  describedBy,
}: {
  readonly assignment: CoachAssignment;
  readonly describedBy: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const [state, action] = useActionState(unassignAction, INITIAL);
  return (
    <div className="flex flex-col gap-2">
      <ConfirmedAction
        action={action}
        fields={{ assignmentId: assignment.id }}
        label={t('unassign')}
        question={t('unassignQuestion', {
          name: assignment.target.name,
          kind: assignment.target.kind,
          days: FORK_OFFER_DAYS,
        })}
        confirm={t('unassignConfirm')}
        cancel={t('unassignCancel')}
        describedBy={describedBy}
      />
      <RefusalLine state={state} />
    </div>
  );
}

/** One assignment: its target, deadline, players, and what can change. */
function AssignmentRow({
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

/**
 * "Assign" on the coach's own repertoire (R-15, R-16, R-51, R-130): pick a
 * linked player or group with an optional deadline; under it, whom it is
 * assigned to, with each player's badges, the deadline to change or clear,
 * and Unassign. The page shows it only in Coach mode.
 */
export function AssignPanel({
  repertoireId,
  data,
}: {
  readonly repertoireId: string;
  readonly data: AssignPanelData;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const titleId = useId();
  const listId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className={PANEL_LABEL}>
        {t('title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <AssignNew repertoireId={repertoireId} data={data} />
      <h3 id={listId} className={`${PANEL_LABEL} mt-4`}>
        {t('list')}
      </h3>
      {data.assignments.length === 0 ? (
        <p className="text-fg-muted">{t('none')}</p>
      ) : (
        <ul aria-labelledby={listId} className="flex flex-col gap-3">
          {data.assignments.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} />
          ))}
        </ul>
      )}
    </section>
  );
}
