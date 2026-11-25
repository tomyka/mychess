/**
 * The main navigation (R-218): which tabs an account has, which one a page
 * belongs to, and the Today tab's due badge. The tab components only render
 * what these decide.
 */
import { ROUTES } from '../../lib/routes';

export type TabId = 'today' | 'repertoires' | 'opponents' | 'coach';

export interface NavTab {
  readonly id: TabId;
  readonly href: string;
}

const TABS: readonly NavTab[] = [
  { id: 'today', href: ROUTES.home },
  { id: 'repertoires', href: ROUTES.repertoires },
  { id: 'opponents', href: ROUTES.fideSearch },
  { id: 'coach', href: ROUTES.coach },
];

/** The tabs in order; Coach only for an account with the coach capability. */
export const navTabs = ({
  isCoach,
}: {
  readonly isCoach: boolean;
}): readonly NavTab[] => TABS.filter((t) => isCoach || t.id !== 'coach');

const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** The tab a path belongs to, or null (settings, training). */
export function activeTab(path: string): TabId | null {
  if (path === ROUTES.home) return 'today';
  return TABS.find((t) => t.id !== 'today' && within(path, t.href))?.id ?? null;
}

/** A tab's own page, where the phone shows the wordmark row. */
export const isTabRoot = (path: string): boolean =>
  TABS.some((t) => t.href === path);

const BADGE_MAX = 99;

/** The Today badge's text, or null when nothing is due. */
export const dueBadge = (due: number): string | null =>
  due <= 0 ? null : due > BADGE_MAX ? `${String(BADGE_MAX)}+` : String(due);
