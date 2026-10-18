'use client';

import type { JSX } from 'react';
import { useSlow } from './use-slow';

/**
 * A loading page's one line: empty at first, then `text` after about a
 * second. The live region is there from the start, so the text is announced.
 */
export function SlowStatus({ text }: { readonly text: string }): JSX.Element {
  const slow = useSlow(true);
  return (
    <p role="status" className="text-sm text-fg-muted">
      {slow ? text : ''}
    </p>
  );
}
