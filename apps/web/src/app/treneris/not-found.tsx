import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { COACH_PAGE, SubpageHeader } from './subpage-header';

// A player not linked to the coach, another coach's group and an id that
// does not exist all read the same (plan decision 4).
export default function CoachNotFound(): JSX.Element {
  const t = useTranslations('coach');
  return (
    <main className={COACH_PAGE}>
      <SubpageHeader title={t('notFound')} />
    </main>
  );
}
