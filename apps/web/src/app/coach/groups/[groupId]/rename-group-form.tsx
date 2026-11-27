'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type JSX } from 'react';
import { PRIMARY_BUTTON, QUIET_ACTION } from '../../../buttons';
import { FIELD } from '../../../fields';
import { StatusLine } from '../../../status-line';
import { submitByHand } from '../../../submit-by-hand';
import type { RenameGroupState } from '../../actions';

/** The name field, focused as the form opens; marked invalid when refused. */
function NameField({
  name,
  statusId,
  refused,
}: {
  readonly name: string;
  readonly statusId: string;
  readonly refused: boolean;
}): JSX.Element {
  const t = useTranslations('coach.groups');
  const fieldId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);
  return (
    <div className="flex grow flex-col gap-2">
      <label htmlFor={fieldId} className="font-medium">
        {t('name')}
      </label>
      <input
        ref={fieldRef}
        id={fieldId}
        type="text"
        name="name"
        defaultValue={name}
        autoComplete="off"
        aria-invalid={refused ? true : undefined}
        aria-describedby={refused ? statusId : undefined}
        className={`${FIELD} aria-invalid:border-error`}
      />
    </div>
  );
}

/**
 * The group's name to rename it, in place of the title (R-113: refused
 * with Coach mode off). The header holds the action's state, so it can
 * close the form once saved; a refusal keeps it open with what was typed.
 */
export function RenameGroupForm({
  groupId,
  name,
  state,
  action,
  pending,
  onCancel,
}: {
  readonly groupId: string;
  readonly name: string;
  readonly state: RenameGroupState;
  readonly action: (form: FormData) => void;
  readonly pending: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="groupId" value={groupId} />
        <NameField
          name={name}
          statusId={statusId}
          refused={state.refusal !== undefined}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t('coach.group.save')}
          </button>
          <button type="button" onClick={onCancel} className={QUIET_ACTION}>
            {t('coach.group.cancel')}
          </button>
        </div>
      </form>
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </div>
  );
}
