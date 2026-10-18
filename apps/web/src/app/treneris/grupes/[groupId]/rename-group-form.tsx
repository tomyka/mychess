'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../../../buttons';
import { StatusLine } from '../../../status-line';
import { submitByHand } from '../../../submit-by-hand';
import { renameGroupAction, type RenameGroupState } from '../../actions';

const INITIAL: RenameGroupState = {};

/** The group's name, to rename it (R-113: refused with Coach mode off). */
export function RenameGroupForm({
  groupId,
  name,
}: {
  readonly groupId: string;
  readonly name: string;
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useActionState(renameGroupAction, INITIAL);
  const refused = state.refusal !== undefined;
  const status =
    state.refusal === undefined
      ? state.saved === true
        ? t('coach.group.saved')
        : null
      : t(state.refusal);
  return (
    <>
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <div className="flex grow flex-col gap-2">
          <label htmlFor={fieldId} className="font-medium">
            {t('coach.groups.name')}
          </label>
          <input
            id={fieldId}
            type="text"
            name="name"
            defaultValue={name}
            autoComplete="off"
            aria-invalid={refused ? true : undefined}
            aria-describedby={refused ? statusId : undefined}
            className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
          />
        </div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('coach.group.save')}
        </button>
      </form>
      <StatusLine
        id={statusId}
        text={status}
        tone={refused ? 'error' : 'success'}
      />
    </>
  );
}
