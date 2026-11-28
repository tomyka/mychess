import { myCoachesPath, settingsPath } from '../../lib/routes';
import { activeTab, type TabId } from './nav-tabs';

/** Where the account menu's links go, opened on `path`. */
export interface AccountLinks {
  readonly settings: string;
  readonly myCoaches: string;
}

/**
 * Settings and My coaches, carrying the tab the menu was opened on
 * (`?from=`), so Settings' back link returns there (#381 part 6); a page
 * outside the tabs (training, Settings itself) counts as Today.
 */
export function accountLinks(path: string): AccountLinks {
  const from: TabId = activeTab(path) ?? 'today';
  return { settings: settingsPath(from), myCoaches: myCoachesPath(from) };
}
