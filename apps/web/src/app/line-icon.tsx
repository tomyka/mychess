// The app's small line icons (not `icon.tsx`: Next takes that name for the
// app icon): one 24px path in the text colour, decorative (the words beside
// it, or the button's label, carry the meaning).
import type { JSX } from 'react';

/** A chevron pointing back, for the way back to the parent page. */
export const BACK_ICON = 'M15 6l-6 6 6 6';

/** A chevron pointing down, on a button that opens something below it. */
export const CHEVRON_DOWN_ICON = 'M6 9l6 6 6-6';

/** A tick: a right answer, a session done. */
export const TICK_ICON = 'M5 12l5 5 9-10';

export function Icon({
  path,
  className = 'size-5',
  strokeWidth = 2,
}: {
  /** The path's `d`, on a 24 x 24 grid. */
  readonly path: string;
  /** Its size (a `size-*` class); it never shrinks in a row. */
  readonly className?: string;
  readonly strokeWidth?: number;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
