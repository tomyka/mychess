/**
 * The main navigation (R-218): which tabs an account has, which one a page
 * belongs to, where Settings goes back to, which bar carries the phone
 * account menu, and the Today tab's due badge. The tab components only
 * render what these decide. This is the app's one tab map (#400).
 */
import { ROUTES, type TabId } from '../../lib/routes';

export type { TabId } from '../../lib/routes';

export interface NavTab {
  readonly id: TabId;
  readonly href: string;
}

const TODAY: NavTab = { id: 'today', href: ROUTES.home };

const TABS: readonly NavTab[] = [
  TODAY,
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

/**
 * Where Settings goes back to: the tab it was opened from (`?from=`,
 * untrusted), among the account's own tabs; Today for anything else, so a
 * player sent `?from=coach` is not offered a Coach tab they lack.
 */
export const settingsBack = (
  from: unknown,
  account: { readonly isCoach: boolean },
): NavTab => navTabs(account).find((t) => t.id === from) ?? TODAY;

/**
 * Which bar carries the account menu on a phone at `path`, for the shell
 * pages with a PageHeader (or the group page's own header): the top bar on
 * a tab's own page, where its wordmark row shows; the page's header on any
 * other (an inner page, Settings, the 404), as the top row is collapsed
 * there. Focused screens (training, the repertoire view, the invite page)
 * draw their own header by design and are not decided here.
 */
export const phoneMenuIn = (path: string): 'topBar' | 'header' =>
  isTabRoot(path) ? 'topBar' : 'header';

const BADGE_MAX = 99;

/** The Today badge's text, or null when nothing is due. */
export const dueBadge = (due: number): string | null =>
  due <= 0 ? null : due > BADGE_MAX ? `${String(BADGE_MAX)}+` : String(due);
