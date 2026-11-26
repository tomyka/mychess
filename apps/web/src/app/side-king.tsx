import type { Side } from '@mychess/chess';
import type { JSX } from 'react';

/**
 * Each side's king: the training dot's fixed colours (tokens.css, side-*),
 * so it follows neither the text colour nor the theme (spec "My
 * repertoires"). Both kings are outlined dark: on their light tile the
 * White one reads white and the Black one black.
 */
const COLOURS: Record<Side, string> = {
  white: 'fill-side-white stroke-side-black',
  black: 'fill-side-black stroke-side-black',
};

/**
 * A side's king in the side's own colours on a small light-square tile, the
 * same in both themes: on the dark page a bare Black king vanished and its
 * light outline read as a White one (sign-off #381 part 4).
 */
export function SideKing({ side }: { readonly side: Side }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-board bg-board-light"
    >
      <svg
        viewBox="0 0 24 24"
        className={`size-6 ${COLOURS[side]}`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d="M12 2.5v4M10 4.5h4" fill="none" />
        <path d="M12 8.5c-2-2.5-7-2-7 2.5 0 2.5 2 4 2 6.5h10c0-2.5 2-4 2-6.5 0-4.5-5-5-7-2.5z" />
        <path d="M6.5 17.5h11v3.5h-11z" />
      </svg>
    </span>
  );
}
