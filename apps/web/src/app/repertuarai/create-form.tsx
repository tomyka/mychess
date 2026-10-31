'use client';

import { SIDES } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { useRefusalText } from '../treneris/refusal-line';
import { createRepertoireAction, type CreateState } from './actions';

const INITIAL: CreateState = {};

const FIELD =
  'min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken has-checked:ring-1 has-checked:ring-accent';

/** White or Black, as two radio cards (the LanguageField pattern). */
function SideField(): JSX.Element {
  const t = useTranslations('repertoires.create');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('side')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((side) => (
          <label key={side} className={CHOICE}>
            <input
              type="radio"
              name="side"
              value={side}
              defaultChecked={side === 'white'}
              className="size-5 accent-accent"
            />
            {t(side)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
  const nameRefused = state.refusal?.startsWith('repertoire.name') === true;
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
