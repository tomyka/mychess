'use client';

import type { JSX } from 'react';
import { useSlow } from './use-slow';

/**
 * A loading page's one line, `text` after about a second. The visible line
 * is revealed by CSS (`animate-reveal-late`), so it shows even in a
 * server-streamed fallback that is never hydrated; the live region is there
 * from the start and gets the text from the client timer, so it is announced.
 */
export function SlowStatus({ text }: { readonly text: string }): JSX.Element {
  const slow = useSlow(true);
  return (
    <p className="text-sm text-fg-muted">
      <span aria-hidden="true" className="animate-reveal-late">
        {text}
      </span>
      <span role="status" className="sr-only">
        {slow ? text : ''}
      </span>
    </p>
  );
}
