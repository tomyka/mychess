'use client';

import { LOCALES, type Locale } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import {
  startTransition,
  useActionState,
  useId,
  type JSX,
  type SubmitEvent,
} from 'react';
import type { ProfileRefusalKey } from '../../server/profile-input';
import { completeOnboardingAction, type OnboardingState } from './actions';

export interface OnboardingFormProps {
  /** The name Google or Lichess gave, or empty (R-81). */
  readonly displayName: string;
  /** The language the page is shown in; Lithuanian for a new account. */
  readonly locale: Locale;
}

const INITIAL: OnboardingState = {};

const isNameRefusal = (refusal: ProfileRefusalKey | undefined): boolean =>
  refusal?.startsWith('displayName.') === true;

/** The polite live region a refusal is announced in. */
function StatusLine({
  id,
  refusal,
}: {
  readonly id: string;
  readonly refusal: ProfileRefusalKey | undefined;
}): JSX.Element {
  const t = useTranslations();
  return (
    <p
      id={id}
      role="status"
      className={
        refusal === undefined
          ? 'sr-only'
          : 'rounded-control bg-error-subtle px-4 py-3 text-error'
      }
    >
      {refusal === undefined ? '' : t(refusal)}
    </p>
  );
}

/** The display name, with a hint, and the refusal when it is the name's. */
function NameField({
  initial,
  invalid,
  statusId,
}: {
  readonly initial: string;
  readonly invalid: boolean;
  readonly statusId: string;
}): JSX.Element {
  const t = useTranslations('onboarding');
  const inputId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="font-medium">
        {t('displayName')}
      </label>
      <input
        id={inputId}
        type="text"
        name="displayName"
        autoComplete="nickname"
        defaultValue={initial}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${hintId} ${statusId}` : hintId}
        className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
      />
      <p id={hintId} className="text-sm text-fg-muted">
        {t('displayNameHint')}
      </p>
    </div>
  );
}

/** One choice per site language, each named in its own language. */
function LanguageField({ initial }: { readonly initial: Locale }): JSX.Element {
  const t = useTranslations();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('onboarding.language')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {LOCALES.map((option) => (
          <label
            key={option}
            lang={option}
            className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken"
          >
            <input
              type="radio"
              name="locale"
              value={option}
              defaultChecked={option === initial}
              className="size-5 accent-accent"
            />
            {t(`language.${option}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
  // Submitted by hand rather than through <form action>: React resets a
  // form after its action, which would wipe a refused name and choice.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => {
      action(form);
    });
  };
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
        <StatusLine id={statusId} refusal={state.refusal} />
        {/* noValidate: the server's refusal is shown in the page's
            language, not the browser's. */}
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <NameField
            initial={displayName}
            invalid={isNameRefusal(state.refusal)}
            statusId={statusId}
          />
          <LanguageField initial={locale} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-touch rounded-control bg-accent px-4 py-2 text-base font-semibold text-accent-fg disabled:opacity-60"
          >
            {t('onboarding.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}
