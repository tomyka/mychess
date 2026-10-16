import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ROUTES } from '../lib/routes';
import { SignOutButton } from './sign-out-button';

/** The home page for a signed-in, onboarded account. */
export function HomeView({
  displayName,
}: {
  readonly displayName: string;
}): JSX.Element {
  const t = useTranslations('app');
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-8 sm:px-gutter-wide">
      <header className="flex flex-col gap-2">
        <p className="text-lg font-bold text-accent">{t('title')}</p>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {t('greeting', { name: displayName })}
        </h1>
      </header>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={ROUTES.settings}
          className="inline-flex min-h-touch items-center text-accent underline"
        >
          {t('settings')}
        </Link>
        <SignOutButton />
      </div>
    </main>
  );
}
