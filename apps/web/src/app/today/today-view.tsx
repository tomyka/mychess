import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { TodayPage } from '../../server/today-page';
import { ForkOffers } from '../fork-offers';
import { CARD, CONTENT } from '../surfaces';
import { heroState } from './hero-state';
import { LinkedNotice } from './linked-notice';
import { RepertoireRows } from './repertoire-rows';
import { TodayHero } from './today-hero';

/**
 * Today (#381 part 2): after accepting an invite the linked notice
 * (R-234), then the greeting, the hero, the list of every trained
 * repertoire and the copies left to keep. One column on a phone (hero,
 * list, offers); from md two columns, the hero and offers on the left, the
 * list on the right. The first row is the hero's height (the list spans
 * both rows, so its height goes to the second), keeping the offers right
 * under the hero. The h1 is for screen readers; the hero's count is the
 * visual headline.
 */
export function TodayView({
  displayName,
  summary,
  rows,
  offers,
  linked,
}: TodayPage): JSX.Element {
  const t = useTranslations();
  const state = heroState({
    due: summary.due,
    toLearn: summary.toLearn,
    rows: rows.length,
  });
  return (
    <main className={`${CONTENT} gap-4`}>
      <h1 className="sr-only">{t('today.title')}</h1>
      {linked === null ? null : <LinkedNotice linked={linked} />}
      <p className="text-fg-muted">
        {t('app.greeting', { name: displayName })}
      </p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-[auto_1fr] md:items-start">
        <div className="md:col-start-1 md:row-start-1">
          <TodayHero state={state} summary={summary} />
        </div>
        {rows.length === 0 ? null : (
          <div className="md:col-start-2 md:row-span-2 md:row-start-1">
            <RepertoireRows rows={rows} />
          </div>
        )}
        {offers.length === 0 ? null : (
          <div className={`${CARD} p-5 md:col-start-1 md:row-start-2`}>
            <ForkOffers offers={offers} />
          </div>
        )}
      </div>
    </main>
  );
}
