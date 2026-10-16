import type { JSX } from 'react';

type Tone = 'success' | 'error' | 'info';

const TONES: Record<Tone, string> = {
  success: 'bg-success-subtle text-success',
  error: 'bg-error-subtle text-error',
  info: 'bg-sunken text-fg',
};

export interface StatusLineProps {
  /** Lets a field point at the line with aria-describedby. */
  readonly id?: string;
  /** The translated message, or null for an empty, hidden line. */
  readonly text: string | null;
  readonly tone: Tone;
}

/**
 * The polite live region a form announces its outcome in. It is always
 * rendered, so a screen reader hears the text that appears in it.
 */
export function StatusLine({ id, text, tone }: StatusLineProps): JSX.Element {
  return (
    <p
      id={id}
      role="status"
      className={
        text === null ? 'sr-only' : `rounded-control px-4 py-3 ${TONES[tone]}`
      }
    >
      {text ?? ''}
    </p>
  );
}
