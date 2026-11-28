'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { BRAND } from '../../lib/brand';
import { ROUTES } from '../../lib/routes';
import { AccountMenu } from './account-menu';
import { phoneMenuIn } from './nav-tabs';
import { TabNav } from './tab-nav';

/**
 * The wordmark, the tabs and the avatar, in that keyboard order. On a phone
 * the tabs sit fixed at the bottom and the wordmark and avatar show only on
 * a tab's own page (lead decision 3): elsewhere the row collapses but stays
 * rendered, so the tabs in it stay. From md it is one sticky bar with the
 * tabs centred in it.
 */
export function TopBar({
  isCoach,
  due,
}: {
  readonly isCoach: boolean;
  readonly due: number;
}): JSX.Element {
  const root = phoneMenuIn(usePathname()) === 'topBar';
  const row = root ? 'h-tabbar' : 'h-0 md:h-tabbar';
  const end = root ? 'flex' : 'hidden md:flex';
  return (
    <header className="relative z-20 bg-surface md:sticky md:top-0 md:shadow-card">
      <div
        className={`${row} mx-auto flex max-w-content items-center justify-between gap-4 px-gutter sm:px-gutter-wide`}
      >
        <div className={end}>
          <Link
            href={ROUTES.home}
            className="text-lg font-bold tracking-tight text-fg"
          >
            {BRAND}
          </Link>
        </div>
        <TabNav isCoach={isCoach} due={due} />
        <div className={end}>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
