'use client';

import { canDelete, type DeletableAccount } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import {
  useActionState,
  useId,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { DANGER_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { deleteAccountAction, type DeleteState } from './actions';
import { DANGER_SECTION, SECTION_TITLE } from './styles';

export const EXPORT_PATH = '/api/account/export';

const INITIAL: DeleteState = {};

const ITEMS = ['account', 'providers', 'sessions'] as const;

// The value set apart from the sentence around it.
const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

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
            <a href={EXPORT_PATH} download className="text-accent underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </>
  );
}

/**
 * What to type: the display name (R-82), or the email address for an
 * account that has not been through onboarding (R-86).
 */
function ConfirmLabel({
  account,
  htmlFor,
}: {
  readonly account: DeletableAccount;
  readonly htmlFor: string;
}): JSX.Element {
  const t = useTranslations('settings.delete');
  return (
    <label htmlFor={htmlFor} className="font-medium">
      {account.onboardedAt === null
        ? t.rich('typeEmail', { email: account.email, strong })
        : t.rich('typeName', { name: account.displayName, strong })}
    </label>
  );
}

/**
 * Deleting the account (R-40, R-82, R-86): confirmed by typing the display
 * name, or the email before onboarding. The button waits for the same
 * domain check the server makes again.
 */
export function DeleteSection({
  account,
}: {
  readonly account: DeletableAccount;
}): JSX.Element {
  const t = useTranslations();
  const titleId = useId();
  const fieldId = useId();
  const statusId = useId();
  const [typed, setTyped] = useState('');
  const [state, action, pending] = useActionState(deleteAccountAction, INITIAL);
  const refused = state.refusal !== undefined;
  const byEmail = account.onboardedAt === null;
  return (
    <section aria-labelledby={titleId} className={DANGER_SECTION}>
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
        <ConfirmLabel account={account} htmlFor={fieldId} />
        <input
          id={fieldId}
          type={byEmail ? 'email' : 'text'}
          name="confirmation"
          autoComplete="off"
          autoCapitalize={byEmail ? 'none' : undefined}
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
