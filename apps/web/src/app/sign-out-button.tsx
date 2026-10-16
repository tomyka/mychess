'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { authClient } from '../lib/auth-client';

/** Ends this browser's session and goes to sign-in. */
export function SignOutButton(): JSX.Element {
  const t = useTranslations('app');
  const router = useRouter();
  const signOut = async (): Promise<void> => {
    await authClient.signOut();
    router.push('/prisijungti');
  };
  return (
    <button
      type="button"
      className="inline-flex min-h-touch items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2 text-base font-semibold text-fg"
      onClick={() => void signOut()}
    >
      {t('signOut')}
    </button>
  );
}
