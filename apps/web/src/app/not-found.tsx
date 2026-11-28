import { accountStage } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { getAccount } from '../server/session';
import { EntryFrame, EntryTitle } from './entry-frame';
import { GoToday } from './go-today';
import { AppShell } from './shell/app-shell';
import { PageHeader } from './shell/page-header';
import { CONTENT } from './surfaces';

/** In the shell: a page with its title row, as every shell page has. */
function InShell(): JSX.Element {
  const t = useTranslations('notFound');
  return (
    <AppShell>
      <main className={`${CONTENT} gap-8`}>
        <PageHeader title={t('title')}>
          <p className="text-fg-muted">{t('body')}</p>
        </PageHeader>
        <GoToday look="primary" />
      </main>
    </AppShell>
  );
}

/** In the entry frame: the frame's card, as sign-in has. */
function InFrame(): JSX.Element {
  const t = useTranslations('notFound');
  return (
    <EntryFrame>
      <EntryTitle>{t('title')}</EntryTitle>
      <p className="text-fg-muted">{t('body')}</p>
      <GoToday look="primary" />
    </EntryFrame>
  );
}

/**
 * The app's 404 (#381 part 6): in the shell for an onboarded account, as
 * coach/not-found.tsx is; otherwise in the entry frame, since the shell
 * would send a new account to onboarding and a visitor to sign-in.
 */
export default async function NotFound(): Promise<JSX.Element> {
  const account = await getAccount();
  return account !== null && accountStage(account) === 'onboarded' ? (
    <InShell />
  ) : (
    <InFrame />
  );
}
