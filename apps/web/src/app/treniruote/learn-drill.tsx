'use client';

import type { JSX } from 'react';
import type { DrillProps } from './drill';

/**
 * The learn drill. A placeholder until Task C6 builds it: the frame with
 * the start position and an empty panel.
 */
export function LearnDrill({ frame }: DrillProps): JSX.Element {
  return frame({ panel: null });
}
