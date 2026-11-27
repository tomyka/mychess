import type { JSX, ReactNode } from 'react';

/**
 * Each pill tone's colours. Every pill has a border so all are one height;
 * the neutral one shows it, as `sunken` alone is the page colour on a
 * phone. `learned` and `due` stay the progress colours
 * (docs/design/README.md), so "forked" and "paused" are neutral: an
 * outline and muted text, without a fill, which with the strong border
 * and full text colour made Paused look like a button (#381 part 4). Done
 * is a green outline, so it does not read as Mastered's green fill.
 */
const TONES = {
  overdue: 'border-transparent bg-error-subtle text-error',
  neutral: 'border-border-strong text-fg-muted',
  done: 'border-success text-success',
  mastered: 'border-transparent bg-success-subtle text-success',
  updated: 'border-transparent bg-accent text-accent-fg',
} as const;

export type PillTone = keyof typeof TONES;

/** The classes of a pill in `tone`, for an element that is not a span. */
export const pillClass = (tone: PillTone): string =>
  `w-fit rounded-pill border px-2 py-0.5 text-sm font-semibold ${TONES[tone]}`;

/** A short status word in a pill: Overdue, Paused, Done, Mastered, Updated. */
export function Pill({
  tone,
  children,
}: {
  readonly tone: PillTone;
  readonly children: ReactNode;
}): JSX.Element {
  return <span className={pillClass(tone)}>{children}</span>;
}
