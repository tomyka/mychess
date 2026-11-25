import type { JSX } from 'react';

/**
 * A decorative bar of `percent` learned; the text beside it carries the
 * value. The track is `border`, as `sunken` vanishes on a card (1.2:1).
 */
export function LearnedBar({
  percent,
}: {
  readonly percent: number;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-pill bg-border"
    >
      <span
        className="block h-full rounded-pill bg-learned"
        style={{ width: `${String(percent)}%` }}
      />
    </span>
  );
}
