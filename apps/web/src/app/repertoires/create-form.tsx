'use client';

import { isRepertoireNameRefusal } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { useRefusalText } from '../coach/refusal-line';
import { createRepertoireAction, type CreateState } from './actions';
import { SideField } from './side-field';

const INITIAL: CreateState = {};

/**
 * The "new repertoire" form: a name and a side, one submit. On success the
 * action opens the new repertoire; a refusal keeps what was typed.
 */
export function CreateForm(): JSX.Element {
  const t = useTranslations();
  const refusalText = useRefusalText();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useActionState(
    createRepertoireAction,
    INITIAL,
  );
  const nameRefused =
    state.refusal !== undefined &&
    isRepertoireNameRefusal({ reason: state.refusal });
  return (
    <form
      noValidate
      onSubmit={submitByHand(action)}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="font-medium">
          {t('repertoires.create.name')}
        </label>
        <input
          id={fieldId}
          type="text"
          name="name"
          autoComplete="off"
          aria-invalid={nameRefused ? true : undefined}
          aria-describedby={nameRefused ? statusId : undefined}
          className={FIELD}
        />
      </div>
      <SideField />
      <button
        type="submit"
        disabled={pending}
        className={`${PRIMARY_BUTTON} w-full sm:w-auto sm:self-start`}
      >
        {t('repertoires.create.submit')}
      </button>
      <StatusLine id={statusId} text={refusalText(state)} tone="error" />
    </form>
  );
}
