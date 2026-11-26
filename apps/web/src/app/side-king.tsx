import type { Side } from '@mychess/chess';
import type { JSX } from 'react';

/**
 * Each side's king: the training dot's fixed colours (tokens.css, side-*),
 * so it follows neither the text colour nor the theme (spec "My
 * repertoires").
 */
const COLOURS: Record<Side, string> = {
  white: 'fill-side-white stroke-side-black',
  black: 'fill-side-black stroke-side-ring',
};

/** A side's king in the side's own colours, the same in both themes. */
export function SideKing({ side }: { readonly side: Side }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-6 shrink-0 ${COLOURS[side]}`}
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M12 2.5v4M10 4.5h4" fill="none" />
      <path d="M12 8.5c-2-2.5-7-2-7 2.5 0 2.5 2 4 2 6.5h10c0-2.5 2-4 2-6.5 0-4.5-5-5-7-2.5z" />
      <path d="M6.5 17.5h11v3.5h-11z" />
    </svg>
  );
}
