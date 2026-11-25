'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { Theme } from '../../lib/theme';

/** What the server tells the shell's client parts about the session account. */
export interface ShellAccount {
  readonly accountId: string;
  readonly displayName: string;
  readonly theme: Theme;
}

/** The account plus the theme as it is now in this browser. */
export interface ShellState extends ShellAccount {
  readonly setTheme: (theme: Theme) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({
  value,
  children,
}: {
  readonly value: ShellAccount;
  readonly children: ReactNode;
}): JSX.Element {
  const [theme, setTheme] = useState(value.theme);
  const state = useMemo(() => ({ ...value, theme, setTheme }), [value, theme]);
  return <ShellContext value={state}>{children}</ShellContext>;
}

/** The shell's account; null outside the shell (training, sign-in). */
export const useShellAccount = (): ShellState | null =>
  useContext(ShellContext);
