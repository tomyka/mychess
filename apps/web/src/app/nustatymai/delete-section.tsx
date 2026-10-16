'use client';

import { canDelete, type Account } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, useState, type JSX } from 'react';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { deleteAccountAction, type DeleteState } from './actions';
import { DANGER_BUTTON, SECTION, SECTION_TITLE } from './styles';

export const EXPORT_PATH = '/api/account/export';

const INITIAL: DeleteState = {};

const ITEMS = ['account', 'providers', 'sessions'] as const;

/** What deleting removes, and the export offered before it (R-82). */
function WhatGoes(): JSX.Element {
  const t = useTranslations('settings.delete');
  return (
    <>
      <p>{t('whatGoes')}</p>
      <ul className="list-disc ps-6">
        {ITEMS.map((item) => (
          <li key={item}>{t(`items.${item}`)}</li>
        ))}
      </ul>
      <p className="font-medium">{t('irreversible')}</p>
      <p>
        {t.rich('exportFirst', {
          link: (chunks) => (
            <a href={EXPORT_PATH} className="text-accent underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </>
  );
}

/**
 * Deleting the account (R-40, R-82): confirmed by typing the display name.
 * The button waits for the same check the server makes again.
 */
export function DeleteSection({
  account,
}: {
  readonly account: Account;
}): JSX.Element {
  const t = useTranslations();
  const titleId = useId();
  const fieldId = useId();
  const statusId = useId();
  const [typed, setTyped] = useState('');
  const [state, action, pending] = useActionState(deleteAccountAction, INITIAL);
  const refused = state.refusal !== undefined;
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={`${SECTION_TITLE} text-error`}>
        {t('settings.delete.title')}
      </h2>
      <WhatGoes />
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-3"
      >
        <label htmlFor={fieldId} className="font-medium">
          {t('settings.delete.typeName', { name: account.displayName })}
        </label>
        <input
          id={fieldId}
          type="text"
          name="typedName"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          aria-invalid={refused ? true : undefined}
          aria-describedby={refused ? statusId : undefined}
          className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
        />
        <button
          type="submit"
          disabled={pending || !canDelete(account, typed).ok}
          className={DANGER_BUTTON}
        >
          {t('settings.delete.confirm')}
        </button>
      </form>
    </section>
  );
}
