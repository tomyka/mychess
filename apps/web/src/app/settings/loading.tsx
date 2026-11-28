import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { CardSkeletons } from '../card-skeletons';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';

/** Settings while it loads: its header, then its cards, in its column. */
export default function SettingsLoading(): JSX.Element {
  const t = useTranslations();
  return (
    <main aria-busy="true" className={`${CONTENT} gap-8`}>
      <PageHeader
        back={{ href: ROUTES.home, parent: t('nav.today') }}
        title={t('settings.title')}
      />
      {/* About each card's height, in the page's order (ux-designer). */}
      <CardSkeletons sizes={['h-[29rem]', 'h-40', 'h-96', 'h-44', 'h-56']} />
    </main>
  );
}
