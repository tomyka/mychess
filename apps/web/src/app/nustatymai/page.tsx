import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { googleConfigured, readWebEnv } from '../../server/env';
import { linkedProviders } from '../../server/provider-links';
import { requireOnboarded } from '../../server/session';
import { DeleteSection, EXPORT_PATH } from './delete-section';
import { ProfileForm } from './profile-form';
import { Providers } from './providers';
import { SECONDARY_BUTTON, SECTION, SECTION_TITLE, TEXT_LINK } from './styles';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** The data export: a plain download link (R-40). */
function ExportSection(): JSX.Element {
  const t = useTranslations('settings.export');
  return (
    <section aria-labelledby="settings-export" className={SECTION}>
      <h2 id="settings-export" className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <p className="text-fg-muted">{t('intro')}</p>
      <div>
        <a href={EXPORT_PATH} download className={SECONDARY_BUTTON}>
          {t('download')}
        </a>
      </div>
    </section>
  );
}

function Header(): JSX.Element {
  const t = useTranslations();
  return (
    <header className="flex flex-col gap-1">
      <Link href="/" className={TEXT_LINK}>
        {t('settings.home')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('settings.title')}</h1>
    </header>
  );
}

// Signed-out visitors go to sign-in, new accounts to onboarding first;
// a failed provider link comes back here with `?error=`.
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const links = await linkedProviders();
  const params = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <ProfileForm displayName={account.displayName} locale={account.locale} />
      <Providers
        links={links}
        googleEnabled={googleConfigured(readWebEnv())}
        email={account.email}
        error={first(params['error'])}
      />
      <ExportSection />
      <DeleteSection account={account} />
    </main>
  );
}
