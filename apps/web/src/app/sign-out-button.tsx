'use client';

import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { authClient } from '../lib/auth-client';
import { ROUTES } from '../lib/routes';
import { SECONDARY_BUTTON } from './buttons';
import { flushThenClear } from './training/result-queue';
import { postBatch } from './training/use-result-sync';

/**
 * Ends this browser's session and goes to sign-in. The account's unsent
 * training results get one last try while the session lasts, then every
 * queued result leaves the browser.
 */
export function SignOutButton({
  accountId,
  className = SECONDARY_BUTTON,
}: {
  readonly accountId: string;
  /** Its look: a secondary button unless said (the account menu's row). */
  readonly className?: string;
}): JSX.Element {
  const t = useTranslations('app');
  const router = useRouter();
  const signOut = async (): Promise<void> => {
    await flushThenClear(() => window.localStorage, accountId, postBatch);
    await authClient.signOut();
    router.push(ROUTES.signIn);
  };
  return (
    <button type="button" className={className} onClick={() => void signOut()}>
      {t('signOut')}
    </button>
  );
}
