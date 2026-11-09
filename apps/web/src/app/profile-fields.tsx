import type { Locale } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { ProfileRefusalKey } from '../server/profile-input';

/** Is the refusal about the display name (rather than the language)? */
export const isNameRefusal = (
  refusal: ProfileRefusalKey | undefined,
): boolean => refusal?.startsWith('displayName.') === true;

export interface NameFieldProps {
  readonly label: string;
  /** Shown under the field, if given. */
  readonly hint?: string;
  readonly initial: string;
  /** Marks the field and points it at the status line's refusal. */
  readonly invalid: boolean;
  readonly statusId: string;
}

/** The display name field onboarding and settings share. */
export function NameField({
  label,
  hint,
  initial,
  invalid,
  statusId,
}: NameFieldProps): JSX.Element {
  const inputId = useId();
  const hintId = useId();
  const described = [
    hint === undefined ? undefined : hintId,
    invalid ? statusId : undefined,
  ].filter((id) => id !== undefined);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        name="displayName"
        autoComplete="nickname"
        defaultValue={initial}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={
          described.length === 0 ? undefined : described.join(' ')
        }
        className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * One choice per offered language, each named in its own language. With
 * one language offered (R-180) nothing is asked: the stored language goes
 * back as it is, so saving the form never changes it.
 */
export function LanguageField({
  legend,
  initial,
  offered,
}: {
  readonly legend: string;
  readonly initial: Locale;
  /** The languages to choose from (OFFERED_LOCALES). */
  readonly offered: readonly Locale[];
}): JSX.Element {
  const t = useTranslations('language');
  if (offered.length < 2)
    return <input type="hidden" name="locale" value={initial} />;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        {offered.map((option) => (
          <label
            key={option}
            lang={option}
            className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken has-checked:ring-1 has-checked:ring-accent"
          >
            <input
              type="radio"
              name="locale"
              value={option}
              defaultChecked={option === initial}
              className="size-5 accent-accent"
            />
            {t(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
