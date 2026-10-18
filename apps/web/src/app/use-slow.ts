'use client';

import { useEffect, useState } from 'react';

/** How long a wait lasts before the page says what is happening. */
const SLOW_MS = 1000;

/** True once `pending` has lasted about a second (docs/design: no spinner first). */
export function useSlow(pending: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);
  return pending && slow;
}
