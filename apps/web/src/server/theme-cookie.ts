import 'server-only';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme, type Theme } from '../lib/theme';

/** The theme the request's cookie asks for; anything unknown is 'system'. */
export async function readThemeCookie(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
