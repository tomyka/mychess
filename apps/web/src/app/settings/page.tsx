import { playerCoaches, trainingSettings } from '@mychess/db';
import {
  deletableAccount,
  isCoach,
  type DeletableAccount,
} from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { getDb } from '../../server/db';
import { googleConfigured, readWebEnv } from '../../server/env';
import { showLichessUnlinked } from '../../server/lichess-unlinked';
import { linkedProviders } from '../../server/provider-links';
import { hasFreshSession, requireOnboarded } from '../../server/session';
import { DeleteAccountControl } from '../delete-account-control';
import { EXPORT_PATH, ExportNotFresh } from '../delete-account-form';
import { CoachMode } from './coach-mode';
import { LichessUnlinkedNotice } from './lichess-unlinked-notice';
import { MyCoaches } from './my-coaches';
import { ProfileForm } from './profile-form';
import { Providers } from './providers';
import { TrainingForm } from './training-form';
import { SECONDARY_BUTTON } from '../buttons';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';
import { SECTION, SECTION_TITLE } from './styles';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

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
    <section aria-labelledby="settings-export" className={SECTION}>
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

function Header(): JSX.Element {
  const t = useTranslations();
  return (
    <PageHeader
      back={{ href: ROUTES.home, parent: t('nav.today') }}
      title={t('settings.title')}
    />
  );
}

// Signed-out visitors go to sign-in, new accounts to onboarding first;
// a failed provider link comes back here with `?error=`. Settings says
// why Lichess is gone when proving the email ended its link (R-90).
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const links = await linkedProviders();
  const lichessUnlinked = await showLichessUnlinked(account.id, links);
  const params = await searchParams;
  const fresh = await hasFreshSession();
  const coaches = await playerCoaches(getDb(), account.id);
  const training = await trainingSettings(getDb(), account.id);
  return (
    <main className={`${CONTENT} gap-8`}>
      <Header />
      <ProfileForm displayName={account.displayName} />
      <TrainingForm settings={training} />
      <CoachMode isCoach={isCoach(account)} />
      <MyCoaches
        coaches={coaches.map(({ id, displayName, groups }) => ({
          id,
          displayName,
          groups,
        }))}
      />
      <Providers
        links={links}
        googleEnabled={googleConfigured(readWebEnv())}
        email={account.email}
        error={first(params['error'])}
      >
        {lichessUnlinked ? <LichessUnlinkedNotice /> : null}
      </Providers>
      <DataSection account={deletableAccount(account)} fresh={fresh} />
    </main>
  );
}
