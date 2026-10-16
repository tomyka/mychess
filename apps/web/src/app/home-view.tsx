import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { SignOutButton } from './sign-out-button';

/** The home page for a signed-in, onboarded account. */
export function HomeView({
  displayName,
}: {
  readonly displayName: string;
}): JSX.Element {
  const t = useTranslations('app');
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p>{t('greeting', { name: displayName })}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/nustatymai" className="text-accent underline">
          {t('settings')}
        </Link>
        <SignOutButton />
      </div>
    </main>
  );
}
