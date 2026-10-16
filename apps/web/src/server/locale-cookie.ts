import type { Locale } from '@mychess/domain';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from '../i18n/locales';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Keeps a chosen language in the locale cookie, so the site stays in it
 * after sign-out (signed in, the account's own locale wins).
 */
export async function rememberLocale(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  });
}
