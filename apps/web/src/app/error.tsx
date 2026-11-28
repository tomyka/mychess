'use client';

import type { JSX } from 'react';
import { ErrorView } from './error-view';

/** The app's error page (#381 part 6), under the root layout. */
export default function AppError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): JSX.Element {
  return <ErrorView reset={reset} />;
}
