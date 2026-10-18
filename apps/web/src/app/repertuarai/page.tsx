import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { myRepertoires } from '../../server/repertoires';
import { SECONDARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../nustatymai/styles';
import { StatusLine } from '../status-line';
import { CreateForm } from './create-form';
import { RepertoireList } from './repertoire-list';

type SearchParams = Record<string, string | string[] | undefined>;

function Header(): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
      <p className="text-fg-muted">{t('intro')}</p>
    </header>
  );
}

/** After a delete, the repertoire page comes here with `?deleted=1`. */
function DeletedNotice({ shown }: { readonly shown: boolean }): JSX.Element {
  const t = useTranslations('repertoires.header');
  return <StatusLine text={shown ? t('deleted') : null} tone="success" />;
}

function CreateSection(): JSX.Element {
  const t = useTranslations('repertoires.create');
  return (
    <section aria-labelledby="repertoires-create" className={SECTION}>
      <h2 id="repertoires-create" className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <CreateForm />
    </section>
  );
}

function ImportSection(): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <section aria-labelledby="repertoires-import" className={SECTION}>
      <h2 id="repertoires-import" className={SECTION_TITLE}>
        {t('importTitle')}
      </h2>
      <p className="text-fg-muted">{t('importIntro')}</p>
      <Link
        href={ROUTES.repertoireImport}
        className={`${SECONDARY_BUTTON} w-full sm:w-auto sm:self-start`}
      >
        {t('import')}
      </Link>
    </section>
  );
}

// Mano repertuarai (docs/design/repertoire-screen.md, section 1): the
// account's own repertoires by side, the create form and the way to import.
export default async function RepertoiresPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const items = await myRepertoires();
  const { deleted } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <DeletedNotice shown={deleted === '1'} />
      <RepertoireList items={items} now={new Date()} />
      <div className="grid gap-8 sm:grid-cols-2 sm:items-start">
        <CreateSection />
        <ImportSection />
      </div>
    </main>
  );
}
