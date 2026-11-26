'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX, type KeyboardEvent } from 'react';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { FIELD } from '../../fields';
import { StatusLine } from '../../status-line';
import { submitByHand } from '../../submit-by-hand';
import { renameRepertoireAction, type RenameState } from './actions';
import type { Repertoire } from './repertoire-types';

/** The rename action, telling `onDone` once a name is saved. */
function useRename(onDone: () => void) {
  return useActionState(async (previous: RenameState, form: FormData) => {
    const next = await renameRepertoireAction(previous, form);
    if (next.saved === true) onDone();
    return next;
  }, {});
}

export function RenameForm({
  id,
  name,
  onDone,
  onCancel,
}: Repertoire & {
  readonly onDone: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useRename(onDone);
  const refused = state.refusal !== undefined;
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') onCancel();
  }
  return (
    <form
      noValidate
      onSubmit={submitByHand(action)}
      className="flex w-full flex-col gap-2"
    >
      <input type="hidden" name="repertoireId" value={id} />
      {/* On a wide screen the field takes the title's one row, so the
          board below does not move: the label is read, not shown. */}
      <label htmlFor={fieldId} className="font-medium lg:sr-only">
        {t('repertoires.manage.renameLabel')}
      </label>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <input
          id={fieldId}
          type="text"
          name="name"
          autoComplete="off"
          defaultValue={name}
          autoFocus
          onKeyDown={onKeyDown}
          aria-invalid={refused ? true : undefined}
          aria-describedby={refused ? statusId : undefined}
          className={`${FIELD} lg:min-w-0 lg:flex-1`}
        />
        <div className="flex flex-wrap gap-2 lg:flex-nowrap">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t('repertoires.manage.renameSubmit')}
          </button>
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
            {t('repertoires.manage.renameCancel')}
          </button>
        </div>
      </div>
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
    </form>
  );
}
