import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';

// Another account's repertoire and a malformed id read the same (decision
// 12). Here, not in [id]/, so the 404 its layout throws (#331) lands on it.
export default function RepertoireNotFound(): JSX.Element {
  const t = useTranslations();
  return (
    <main className={`${CONTENT} gap-4`}>
      <PageHeader
        back={{ href: ROUTES.repertoires, parent: t('nav.repertoires') }}
        title={t('repertoire.notFound')}
      />
    </main>
  );
}
