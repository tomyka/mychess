'use client';

import type { Locale } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';
import { isNameRefusal, LanguageField, NameField } from '../profile-fields';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { completeOnboardingAction, type OnboardingState } from './actions';

export interface OnboardingFormProps {
  /** The name Google or Lichess gave, or empty (R-81). */
  readonly displayName: string;
  /** The language the page is shown in; Lithuanian for a new account. */
  readonly locale: Locale;
}

const INITIAL: OnboardingState = {};

/** The one onboarding screen: a display name and a language (R-81). */
export function OnboardingForm({
  displayName,
  locale,
}: OnboardingFormProps): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  const [state, action, pending] = useActionState(
    completeOnboardingAction,
    INITIAL,
  );
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-gutter py-8 sm:px-gutter-wide">
      <div className="flex flex-col gap-6 sm:rounded-card sm:border sm:border-border sm:bg-surface sm:p-8 sm:shadow-card">
        <header className="flex flex-col gap-2">
          <p className="text-lg font-bold text-accent">{t('app.title')}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {t('onboarding.title')}
          </h1>
          <p className="text-fg-muted">{t('onboarding.intro')}</p>
        </header>
        <StatusLine
          id={statusId}
          text={state.refusal === undefined ? null : t(state.refusal)}
          tone="error"
        />
        {/* noValidate: the server's refusal is shown in the page's
            language, not the browser's. */}
        <form
          noValidate
          onSubmit={submitByHand(action)}
          className="flex flex-col gap-6"
        >
          <NameField
            label={t('onboarding.displayName')}
            hint={t('onboarding.displayNameHint')}
            initial={displayName}
            invalid={isNameRefusal(state.refusal)}
            statusId={statusId}
          />
          <LanguageField legend={t('onboarding.language')} initial={locale} />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t('onboarding.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}
