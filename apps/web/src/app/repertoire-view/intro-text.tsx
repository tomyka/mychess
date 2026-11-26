import type { JSX } from 'react';

/**
 * A chapter's intro (R-66) as text, one renderer for both places it shows:
 * the comment strip while browsing, the panel in builder mode (R-112).
 */
export function IntroText({ intro }: { readonly intro: string }): JSX.Element {
  return <span className="break-words">{intro}</span>;
}
