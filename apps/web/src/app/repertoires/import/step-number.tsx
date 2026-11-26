import type { JSX } from 'react';

/** The step number before a step's title. */
export function StepNumber({ n }: { readonly n: number }): JSX.Element {
  return (
    <span aria-hidden="true" className="mr-2 tabular-nums text-fg-muted">
      {n}
    </span>
  );
}
