import { playerCoaches } from '@mychess/db';
import { deletableAccount, isCoach } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { getDb } from '../../server/db';
import { googleConfigured, readWebEnv } from '../../server/env';
import { showLichessUnlinked } from '../../server/lichess-unlinked';
import { linkedProviders } from '../../server/provider-links';
import { hasFreshSession, requireOnboarded } from '../../server/session';
import { DeleteSection, EXPORT_PATH, ExportNotFresh } from './delete-section';
import { CoachMode } from './coach-mode';
import { LichessUnlinkedNotice } from './lichess-unlinked-notice';
import { MyCoaches } from './my-coaches';
import { ProfileForm } from './profile-form';
import { Providers } from './providers';
import { SECONDARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE, TEXT_LINK } from './styles';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The data export: a plain download link (R-40), or, for a session signed
 * in more than a day ago, a note to sign in again first (R-95).
 */
function ExportSection({ fresh }: { readonly fresh: boolean }): JSX.Element {
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
    </section>
  );
}

function Header(): JSX.Element {
  const t = useTranslations();
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('settings.home')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('settings.title')}</h1>
    </header>
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
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <ProfileForm displayName={account.displayName} locale={account.locale} />
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
      <ExportSection fresh={fresh} />
      <DeleteSection account={deletableAccount(account)} canExport={fresh} />
    </main>
  );
}
