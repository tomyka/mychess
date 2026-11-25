import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { myAssignedRepertoires } from '../../../server/assignment-pages';
import { myRepertoires } from '../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../buttons';
import { SECTION, SECTION_TITLE } from '../../settings/styles';
import { PageHeader } from '../../shell/page-header';
import { CONTENT } from '../../surfaces';
import { StatusLine } from '../../status-line';
import { CreateForm } from '../create-form';
import { RepertoireList } from '../repertoire-list';

type SearchParams = Record<string, string | string[] | undefined>;

function Header(): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <PageHeader title={t('title')}>
      <p className="text-fg-muted">{t('intro')}</p>
    </PageHeader>
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

// In the (list) route group so its loading.tsx wraps this page alone: a
// streamed child page answers 200 even when it is not found (#331).
// My repertoires (docs/design/repertoire-screen.md, section 1): the
// account's own repertoires and those assigned to it (#328) by side, the
// create form and the way to import.
export default async function RepertoiresPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const [items, assigned] = await Promise.all([
    myRepertoires(),
    myAssignedRepertoires(),
  ]);
  const { deleted } = await searchParams;
  return (
    <main className={`${CONTENT} gap-8`}>
      <Header />
      <DeletedNotice shown={deleted === '1'} />
      <RepertoireList items={items} assigned={assigned} now={new Date()} />
      <div className="grid gap-8 sm:grid-cols-2 sm:items-start">
        <CreateSection />
        <ImportSection />
      </div>
    </main>
  );
}
