'use client';

import type { JSX } from 'react';
import type { DrillProps } from './drill';

/**
 * The review drill. A placeholder until Task C5 builds it: the frame with
 * the start position and an empty panel.
 */
export function ReviewDrill({ frame }: DrillProps): JSX.Element {
  return frame({ panel: null });
}
