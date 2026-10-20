import { useActionState } from 'react';

/** A server action as a form posts it, with the state it returned last. */
export type FormAction<S> = (
  previous: Awaited<S>,
  form: FormData,
) => Promise<S>;

interface Run<S> {
  readonly action: FormAction<S>;
  readonly form: FormData;
}

/**
 * One state for several actions on the same thing, such as Keep and
 * Decline on one offer: whichever ran last decides what is shown.
 * `using(action)` is a form's handler for that action.
 */
export function useLatestAction<S>(initial: Awaited<S>): {
  readonly state: Awaited<S>;
  readonly pending: boolean;
  readonly using: (action: FormAction<S>) => (form: FormData) => void;
} {
  const [state, dispatch, pending] = useActionState<S, Run<S>>(
    (previous, run) => run.action(previous, run.form),
    initial,
  );
  return {
    state,
    pending,
    using: (action) => (form) => {
      dispatch({ action, form });
    },
  };
}
