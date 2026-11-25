import type { JSX, ReactNode } from 'react';
import { AppShell } from './app-shell';

/**
 * The layout of every segment whose pages sit in the app shell (#381, lead
 * decision 1); each such segment's layout.tsx re-exports it.
 */
export default function ShellLayout({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <AppShell>{children}</AppShell>;
}
