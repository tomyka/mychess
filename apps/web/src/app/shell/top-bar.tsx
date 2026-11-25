'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { BRAND } from '../../lib/brand';
import { ROUTES } from '../../lib/routes';
import { AccountMenu } from './account-menu';
import { isTabRoot } from './nav-tabs';
import { TabNav } from './tab-nav';

/**
 * The wordmark, the tabs and the avatar. On a phone the row shows only on
 * a tab's own page (lead decision 3) and the tabs sit fixed at the bottom;
 * from md it is one sticky bar with the tabs centred in it.
 */
export function TopBar({
  isCoach,
  due,
}: {
  readonly isCoach: boolean;
  readonly due: number;
}): JSX.Element {
  const root = isTabRoot(usePathname());
  const row = root ? 'flex' : 'hidden md:flex';
  return (
    <header className="relative z-20 bg-surface md:sticky md:top-0 md:shadow-card">
      <div
        className={`${row} mx-auto h-tabbar max-w-content items-center justify-between gap-4 px-gutter sm:px-gutter-wide`}
      >
        <Link
          href={ROUTES.home}
          className="text-lg font-bold tracking-tight text-fg"
        >
          {BRAND}
        </Link>
        <AccountMenu />
      </div>
      <TabNav isCoach={isCoach} due={due} />
    </header>
  );
}
