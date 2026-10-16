import { startTransition, type SubmitEvent } from 'react';

/**
 * A form's submit handler that hands its fields to a `useActionState`
 * action. Submitted by hand rather than through `<form action>`: React
 * resets a form after its action, which would wipe what was typed and
 * chosen when the server refuses it.
 */
export function submitByHand(
  action: (form: FormData) => void,
): (event: SubmitEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => {
      action(form);
    });
  };
}
