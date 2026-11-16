'use client';

import type { CoachAssignment } from '@mychess/db';
import { FORK_OFFER_DAYS } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../../buttons';
import { ConfirmedAction } from '../../confirmed-action';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { RefusalLine } from '../../treneris/refusal-line';
import { useLatestAction } from '../../use-latest-action';
import {
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
} from './assign-actions';
import { FIELD, INITIAL, useOutcome } from './assign-outcome';

/** Change the row's deadline, or clear it while there is one (R-51). */
export function DeadlineForms({
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
export function Unassign({
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
