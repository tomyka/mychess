'use client';

import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import {
  DANGER_BUTTON,
  DANGER_OUTLINE_BUTTON,
  DANGER_ROW_FITTED,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  SECONDARY_BUTTON,
  TONAL_BUTTON,
} from './buttons';
import { PendingButton } from './pending-button';

export interface ConfirmedActionProps {
  /** The server action the confirmed form posts to, or useActionState's dispatch. */
  readonly action: (form: FormData) => void | Promise<void>;
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
  /**
   * The confirm button's weight: `danger` (the default) when the action
   * destroys or takes away; `primary` when it only creates, as a fork does.
   */
  readonly tone?: 'danger' | 'primary';
  /**
   * The first button's look: `secondary` (the default); `quiet` text, for
   * an action kept out of the way; `tonal`, for one that belongs to the
   * content (Train here's Mark known); `danger`, outlined in the error
   * tone, for one that takes away (Revoke); `dangerRow`, error-tone text
   * as a full row on a phone and fitted to its label from sm (Unlink).
   */
  readonly look?: keyof typeof FIRST_BUTTON;
  /**
   * Whether it asks, when the page holds that (another control on the page
   * can then open the question); left out, the step holds it itself.
   */
  readonly asking?: Asking | undefined;
}

/** The confirm step held outside: whether it asks, and how to change that. */
export interface Asking {
  readonly open: boolean;
  readonly set: (open: boolean) => void;
}

const CONFIRM_BUTTON = { danger: DANGER_BUTTON, primary: PRIMARY_BUTTON };

const FIRST_BUTTON = {
  secondary: SECONDARY_BUTTON,
  quiet: QUIET_BUTTON,
  tonal: TONAL_BUTTON,
  danger: DANGER_OUTLINE_BUTTON,
  dangerRow: DANGER_ROW_FITTED,
};

/**
 * Focus follows the step, as in the repertoire's delete: on Cancel once it
 * asks, back on the first button once cancelled; nothing on first render.
 */
function useStepFocus(asking: boolean): {
  readonly ask: RefObject<HTMLButtonElement | null>;
  readonly cancel: RefObject<HTMLButtonElement | null>;
} {
  const ask = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const before = useRef(asking);
  useEffect(() => {
    if (asking === before.current) return;
    before.current = asking;
    (asking ? cancel : ask).current?.focus();
  }, [asking]);
  return { ask, cancel };
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
  tone = 'danger',
  look = 'secondary',
  asking: held,
}: ConfirmedActionProps): JSX.Element {
  const [own, setOwn] = useState(false);
  const asking = held?.open ?? own;
  const setAsking = held?.set ?? setOwn;
  const focus = useStepFocus(asking);
  if (!asking)
    return (
      <button
        ref={focus.ask}
        type="button"
        aria-describedby={describedBy}
        onClick={() => {
          setAsking(true);
        }}
        className={`${FIRST_BUTTON[look]} self-start`}
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
        <PendingButton className={CONFIRM_BUTTON[tone]}>
          {confirm}
        </PendingButton>
        <button
          ref={focus.cancel}
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
