'use client';

import type { Locale } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { isNameRefusal, LanguageField, NameField } from '../profile-fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { updateProfileAction, type ProfileState } from './actions';
import { PRIMARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE } from './styles';

export interface ProfileFormProps {
  readonly displayName: string;
  readonly locale: Locale;
}

const INITIAL: ProfileState = {};

/** The display name and language, changed at any time (settings). */
export function ProfileForm({
  displayName,
  locale,
}: ProfileFormProps): JSX.Element {
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
      {/* noValidate: the server's refusal is shown in the page's language,
          not the browser's. */}
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-6"
      >
        <NameField
          label={t('settings.profile.displayName')}
          initial={displayName}
          invalid={isNameRefusal(state.refusal)}
          statusId={statusId}
        />
        <LanguageField
          legend={t('settings.profile.language')}
          initial={locale}
        />
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('settings.profile.submit')}
        </button>
      </form>
    </section>
  );
}
