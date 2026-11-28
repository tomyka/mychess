import { accountStage } from '@mychess/domain';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../lib/routes';
import { getAccount } from '../server/session';
import { PRIMARY_BUTTON } from './buttons';
import { EntryFrame } from './entry-frame';
import { AppShell } from './shell/app-shell';
import { PageHeader } from './shell/page-header';
import { CONTENT } from './surfaces';

/** The way back to Today, under the one line. */
function GoToday(): JSX.Element {
  const t = useTranslations('nav');
  return (
    <Link href={ROUTES.home} className={`${PRIMARY_BUTTON} self-start`}>
      {t('goToday')}
    </Link>
  );
}

/** In the shell: a page with its title row, as every shell page has. */
function InShell(): JSX.Element {
  const t = useTranslations('notFound');
  return (
    <AppShell>
      <main className={`${CONTENT} gap-8`}>
        <PageHeader title={t('title')}>
          <p className="text-fg-muted">{t('body')}</p>
        </PageHeader>
        <GoToday />
      </main>
    </AppShell>
  );
}

/** In the entry frame: the frame's card, as sign-in has. */
function InFrame(): JSX.Element {
  const t = useTranslations('notFound');
  return (
    <EntryFrame>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
      <p className="text-fg-muted">{t('body')}</p>
      <GoToday />
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
