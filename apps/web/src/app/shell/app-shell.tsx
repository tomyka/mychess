import { getTranslations } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';
import { shellData } from '../../server/shell';
import { ShellProvider } from './shell-context';
import { TopBar } from './top-bar';

function SkipLink({ label }: { readonly label: string }): JSX.Element {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:p-3"
    >
      {label}
    </a>
  );
}

/**
 * The frame of every signed-in page but training (R-218): the skip link,
 * the top bar with the tabs and the account menu, and the page. On a phone
 * the page is padded above the fixed tab bar; --shell-chrome tells
 * full-height pages how much of the viewport the shell takes.
 */
export async function AppShell({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  const [data, t] = await Promise.all([shellData(), getTranslations('nav')]);
  return (
    <ShellProvider
      value={{
        accountId: data.accountId,
        displayName: data.displayName,
        email: data.email,
        theme: data.theme,
      }}
    >
      <SkipLink label={t('skip')} />
      <TopBar isCoach={data.isCoach} due={data.due} />
      <div
        id="content"
        className="[--shell-chrome:calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] pb-[var(--shell-chrome)] md:[--shell-chrome:var(--spacing-tabbar)] md:pb-0"
      >
        {children}
      </div>
    </ShellProvider>
  );
}
