'use client';

import type { CoachAssignment } from '@mychess/db';
import { FORK_OFFER_DAYS } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, type JSX } from 'react';
import { PRIMARY_BUTTON, QUIET_BUTTON } from '../../buttons';
import { ConfirmedAction } from '../../confirmed-action';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { RefusalLine } from '../../coach/refusal-line';
import { useLatestAction } from '../../use-latest-action';
import {
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
} from './assign-actions';
import { INITIAL, useOutcome } from './assign-outcome';
import { DeadlineField } from './deadline-field';

/**
 * The row's deadline (R-51): the date field, starting at the current one,
 * with Save deadline, and Clear deadline as a text button while there is
 * one.
 */
export function DeadlineForms({
  assignment,
  describedBy,
  today,
}: {
  readonly assignment: CoachAssignment;
  readonly describedBy: string;
  /** Today in Vilnius: the date field's earliest day. */
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const { state, pending, using } = useLatestAction(INITIAL);
  const outcome = useOutcome(state, t('deadlineSaved'));
  const clear = (): void => {
    const form = new FormData();
    form.set('assignmentId', assignment.id);
    startTransition(() => {
      using(clearDeadlineAction)(form);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        key={assignment.deadline ?? ''}
        noValidate
        onSubmit={submitByHand(using(setDeadlineAction))}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="assignmentId" value={assignment.id} />
        <DeadlineField
          label={t('deadlineLabel')}
          defaultValue={assignment.deadline ?? ''}
          today={today}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="submit"
            disabled={pending}
            aria-describedby={describedBy}
            className={PRIMARY_BUTTON}
          >
            {t('saveDeadline')}
          </button>
          {assignment.deadline === null ? null : (
            <button
              type="button"
              disabled={pending}
              aria-describedby={describedBy}
              onClick={clear}
              className={QUIET_BUTTON}
            >
              {t('clearDeadline')}
            </button>
          )}
        </div>
      </form>
      <StatusLine text={outcome.text} tone={outcome.tone} />
    </div>
  );
}

/**
 * Unassign, in the error tone, behind a confirm that says what happens
 * (R-130): the repertoire leaves the list, their progress on it goes
 * dormant until it comes back, and the players have the fork offer's days
 * to keep their own copy; whoever also has it another way keeps it (R-16),
 * a player through a group on the group's deadline (R-134).
 */
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
        look="danger"
      />
      <RefusalLine state={state} />
    </div>
  );
}
