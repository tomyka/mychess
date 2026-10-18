'use client';

import type { JSX, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * A form's submit button that is disabled while the form's action runs,
 * so it cannot be sent twice. `label` names it for assistive technology
 * when the visible text alone is ambiguous, such as one "Leave group" per
 * group.
 */
export function PendingButton({
  className,
  label,
  children,
}: {
  readonly className: string;
  readonly label?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      className={className}
    >
      {children}
    </button>
  );
}
