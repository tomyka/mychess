'use client';

import { useState, type JSX } from 'react';
import { DANGER_BUTTON, SECONDARY_BUTTON } from './buttons';
import { PendingButton } from './pending-button';

export interface ConfirmedActionProps {
  /** The server action the confirmed form posts to. */
  readonly action: (form: FormData) => Promise<void>;
  /** The hidden fields the form sends. */
  readonly fields: Readonly<Record<string, string>>;
  /** The first button's label. */
  readonly label: string;
  /** What is asked before acting. */
  readonly question: string;
  readonly confirm: string;
  readonly cancel: string;
  /** The id of what the first button acts on, such as a name heading. */
  readonly describedBy?: string;
}

/**
 * An action that needs a confirm step, such as unlinking: the first button
 * only asks; the confirm button posts the form.
 */
export function ConfirmedAction({
  action,
  fields,
  label,
  question,
  confirm,
  cancel,
  describedBy,
}: ConfirmedActionProps): JSX.Element {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        aria-describedby={describedBy}
        onClick={() => {
          setAsking(true);
        }}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {label}
      </button>
    );
  return (
    <form action={action} className="flex flex-col gap-3">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="font-medium">{question}</p>
      <div className="flex flex-wrap gap-3">
        <PendingButton className={DANGER_BUTTON}>{confirm}</PendingButton>
        <button
          type="button"
          onClick={() => {
            setAsking(false);
          }}
          className={SECONDARY_BUTTON}
        >
          {cancel}
        </button>
      </div>
    </form>
  );
}
