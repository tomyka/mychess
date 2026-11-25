import type { JSX } from 'react';
import { useTranslations } from 'next-intl';
import type { HomeAssignments } from '../server/assignment-pages';
import type { TodaySummary } from '../server/training';
import { ForkOffers } from './fork-offers';
import { FromMyCoach } from './from-my-coach';
import { CONTENT } from './surfaces';
import { TodayBlock } from './today-block';

/**
 * The home page for a signed-in, onboarded account: the greeting, today's
 * review (R-142, U1-M1-3), then what the player's coaches assigned them and
 * the copies they can still keep, each shown only when there is any. The
 * ways to the other areas are the shell's tabs and account menu (#381).
 */
export function HomeView({
  displayName,
  fromCoach,
  offers,
  today,
}: {
  readonly displayName: string;
  readonly today: TodaySummary;
} & HomeAssignments): JSX.Element {
  const t = useTranslations('app');
  return (
    <main className={`${CONTENT} gap-6`}>
      <h1 className="text-2xl font-bold sm:text-3xl">
        {t('greeting', { name: displayName })}
      </h1>
      <TodayBlock summary={today} />
      <FromMyCoach assignments={fromCoach} />
      <ForkOffers offers={offers} />
    </main>
  );
}
