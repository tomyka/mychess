'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { targetField } from '../../../lib/assign-target';
import type { AssignPanelData } from '../../../server/coach-assignments';
import { SECONDARY_BUTTON } from '../../buttons';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { assignAction } from './assign-actions';
import { FIELD, INITIAL, useOutcome } from './assign-outcome';

/** Whom the picker offers: those it is not yet assigned to (the loader's). */
type Offer = Pick<AssignPanelData, 'players' | 'groups'>;

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
export function AssignNew({
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
