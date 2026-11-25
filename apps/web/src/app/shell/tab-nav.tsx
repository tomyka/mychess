'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { NavIcon } from './nav-icons';
import { activeTab, dueBadge, navTabs, type NavTab } from './nav-tabs';

// One <nav> for both placements (lead decision 2), rendered once inside the
// top bar's header: fixed to the bottom of a phone, over the home indicator's
// inset; from md centred in the (relative) top bar. The phone bar's top
// line is a shadow, not a border, so the bar is exactly --spacing-tabbar
// tall (plus the inset), as --shell-chrome assumes.
const NAV =
  'fixed inset-x-0 bottom-0 z-20 bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-border)] md:absolute md:inset-y-0 md:left-1/2 md:w-fit md:-translate-x-1/2 md:bg-transparent md:pb-0 md:shadow-none';
const LIST = 'flex md:h-full md:gap-2';
const LINK =
  'relative flex min-h-tabbar min-w-touch flex-1 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium text-fg-muted md:flex-row md:gap-2 md:text-base aria-[current=page]:text-accent md:aria-[current=page]:shadow-[inset_0_-2px_0_var(--color-accent)]';
// The current tab's icon sits in a pill on a phone, so the tab is marked by
// a shape and not by colour alone; from md the underline marks it.
const ICON = 'flex rounded-pill px-4 py-0.5 md:px-0 md:py-0';
const ICON_CURRENT = `${ICON} bg-accent-subtle md:bg-transparent`;
const BADGE =
  'absolute top-1 left-[calc(50%+0.5rem)] rounded-pill bg-due px-1.5 text-xs leading-5 font-semibold text-on-state tabular-nums md:static';

function Tab({
  tab,
  current,
  due,
}: {
  readonly tab: NavTab;
  readonly current: boolean;
  readonly due: number;
}): JSX.Element {
  const t = useTranslations('nav');
  const badge = tab.id === 'today' ? dueBadge(due) : null;
  return (
    <li className="flex flex-1 md:flex-none">
      <Link
        href={tab.href}
        className={LINK}
        aria-current={current ? 'page' : undefined}
        aria-label={badge === null ? undefined : t('todayDue', { count: due })}
      >
        <span className={current ? ICON_CURRENT : ICON}>
          <NavIcon tab={tab.id} />
        </span>
        <span>{t(tab.id)}</span>
        {badge === null ? null : (
          <span aria-hidden="true" className={BADGE}>
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}

/** The main navigation (R-218). */
export function TabNav({
  isCoach,
  due,
}: {
  readonly isCoach: boolean;
  readonly due: number;
}): JSX.Element {
  const t = useTranslations('nav');
  const current = activeTab(usePathname());
  return (
    <nav aria-label={t('label')} className={NAV}>
      <ul className={LIST}>
        {navTabs({ isCoach }).map((tab) => (
          <Tab key={tab.id} tab={tab} current={tab.id === current} due={due} />
        ))}
      </ul>
    </nav>
  );
}
