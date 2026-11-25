'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { NameField } from '../profile-fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { updateProfileAction, type ProfileState } from './actions';
import { PRIMARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE } from './styles';

export interface ProfileFormProps {
  readonly displayName: string;
}

const INITIAL: ProfileState = {};

/** The display name, changed at any time (settings). */
export function ProfileForm({ displayName }: ProfileFormProps): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  const titleId = useId();
  const [state, action, pending] = useActionState(updateProfileAction, INITIAL);
  const text =
    state.refusal === undefined
      ? state.saved === true
        ? t('settings.profile.saved')
        : null
      : t(state.refusal);
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('settings.profile.title')}
      </h2>
      <StatusLine
        id={statusId}
        text={text}
        tone={state.refusal === undefined ? 'success' : 'error'}
      />
      {/* noValidate: the server's refusal is shown, not the browser's. */}
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-6"
      >
        <NameField
          label={t('settings.profile.displayName')}
          initial={displayName}
          invalid={state.refusal !== undefined}
          statusId={statusId}
        />
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('settings.profile.submit')}
        </button>
      </form>
    </section>
  );
}
