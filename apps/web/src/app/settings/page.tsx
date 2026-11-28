import { trainingSettings } from '@mychess/db';
import {
  deletableAccount,
  isCoach,
  type DeletableAccount,
} from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { readSettingsQuery, type SearchParams } from '../../lib/routes';
import { getDb } from '../../server/db';
import { googleConfigured, readWebEnv } from '../../server/env';
import { showLichessUnlinked } from '../../server/lichess-unlinked';
import { linkedProviders } from '../../server/provider-links';
import { hasFreshSession, requireOnboarded } from '../../server/session';
import { myCoachesData } from '../../server/settings-page';
import { SECONDARY_BUTTON } from '../buttons';
import { DeleteAccountControl } from '../delete-account-control';
import { EXPORT_PATH, ExportNotFresh } from '../delete-account-form';
import { settingsBack } from '../shell/nav-tabs';
import { PageHeader } from '../shell/page-header';
import { CoachMode } from './coach-mode';
import { LichessUnlinkedNotice } from './lichess-unlinked-notice';
import { MyCoaches } from './my-coaches';
import { ProfileForm } from './profile-form';
import { Providers } from './providers';
import { SECTION_TITLE, SETTINGS_CARD, SETTINGS_COLUMN } from './styles';
import { TrainingForm } from './training-form';

/** Account: the display name, then the sign-in methods, in one card. */
function AccountSection({
  displayName,
  children,
}: {
  readonly displayName: string;
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations('settings.account');
  return (
    <section aria-labelledby="settings-account" className={SETTINGS_CARD}>
      <h2 id="settings-account" className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <ProfileForm displayName={displayName} />
      <div className="border-t border-border pt-4">{children}</div>
    </section>
  );
}

/**
 * Your data: the export, a plain download link (R-40), or, for a session
 * signed in more than a day ago, a note to sign in again first (R-95); and
 * Delete account…, opening the delete sheet.
 */
function DataSection({
  account,
  fresh,
}: {
  readonly account: DeletableAccount;
  readonly fresh: boolean;
}): JSX.Element {
  const t = useTranslations('settings.export');
  return (
    <section aria-labelledby="settings-export" className={SETTINGS_CARD}>
      <h2 id="settings-export" className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <p className="text-fg-muted">{t('intro')}</p>
      {fresh ? (
        <div>
          <a href={EXPORT_PATH} download className={SECONDARY_BUTTON}>
            {t('download')}
          </a>
        </div>
      ) : (
        <ExportNotFresh />
      )}
      <DeleteAccountControl account={account} canExport={fresh} variant="row" />
    </section>
  );
}

/**
 * "Settings", back to the tab the account menu opened it from (`?from=`),
 * among the account's own tabs (settingsBack), by the tab's own name.
 */
function Header({
  from,
  isCoach,
}: {
  readonly from: string | undefined;
  readonly isCoach: boolean;
}): JSX.Element {
  const t = useTranslations('settings');
  // A tab's name is its id in nav, as the tab bar writes it.
  const tabName = useTranslations('nav');
  const tab = settingsBack(from, { isCoach });
  return (
    <PageHeader
      back={{ href: tab.href, parent: tabName(tab.id) }}
      title={t('title')}
    />
  );
}

// Signed-out visitors go to sign-in, new accounts to onboarding first;
// a failed provider link comes back here with `?error=`. Settings says
// why Lichess is gone when proving the email ended its link (R-90). One
// page of soft cards, most used first (#381 part 6).
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const links = await linkedProviders();
  const lichessUnlinked = await showLichessUnlinked(account.id, links);
  const query = readSettingsQuery(await searchParams);
  const fresh = await hasFreshSession();
  const myCoaches = await myCoachesData(account.id, new Date());
  const training = await trainingSettings(getDb(), account.id);
  return (
    <main className={SETTINGS_COLUMN}>
      <Header from={query.from} isCoach={isCoach(account)} />
      <TrainingForm settings={training} />
      <MyCoaches coaches={myCoaches.coaches} today={myCoaches.today} />
      <AccountSection displayName={account.displayName}>
        <Providers
          links={links}
          googleEnabled={googleConfigured(readWebEnv())}
          email={account.email}
          error={query.error}
        >
          {lichessUnlinked ? <LichessUnlinkedNotice /> : null}
        </Providers>
      </AccountSection>
      <CoachMode isCoach={isCoach(account)} />
      <DataSection account={deletableAccount(account)} fresh={fresh} />
    </main>
  );
}
