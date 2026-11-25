import { useId, type JSX } from 'react';
import { FIELD } from './fields';

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
        className={FIELD}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
