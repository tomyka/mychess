import type { JSX, ReactNode } from 'react';
import { AppShell } from '../shell/app-shell';

// Every page under this tab sits in the app shell (#381, lead decision 1).
export default function Layout({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <AppShell>{children}</AppShell>;
}
