import 'server-only';
// What the app shell (#381, R-218) shows about the session account: its
// name for the avatar, whether it coaches (the Coach tab), the Today
// badge's due count and the theme cookie.
import { isCoach, type Account } from '@mychess/domain';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme, type Theme } from '../lib/theme';
import { logText } from './log-text';
import { requireOnboarded } from './session';
import { todaySummary } from './training';

export interface ShellData {
  readonly accountId: string;
  readonly displayName: string;
  readonly isCoach: boolean;
  /** Due moves for the Today badge; 0 when the count failed. */
  readonly due: number;
  readonly theme: Theme;
}

/**
 * The badge is decoration: a failed count shows no badge, not an error.
 * The failure is logged as logText says (log-text.ts).
 */
async function dueCount(account: Account): Promise<number> {
  try {
    return (await todaySummary(account)).due;
  } catch (error) {
    console.error('shell: due count failed', logText(error));
    return 0;
  }
}

/** What the app shell shows about the session account (#381). */
export async function shellData(): Promise<ShellData> {
  const account = await requireOnboarded();
  const [due, cookieStore] = await Promise.all([dueCount(account), cookies()]);
  return {
    accountId: account.id,
    displayName: account.displayName,
    isCoach: isCoach(account),
    due,
    theme: parseTheme(cookieStore.get(THEME_COOKIE)?.value),
  };
}
