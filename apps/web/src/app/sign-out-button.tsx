'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { authClient } from '../lib/auth-client';
import { SECONDARY_BUTTON } from './buttons';

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
      className={SECONDARY_BUTTON}
      onClick={() => void signOut()}
    >
      {t('signOut')}
    </button>
  );
}
