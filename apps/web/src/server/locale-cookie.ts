import type { Locale } from '@mychess/domain';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, OFFERS_LANGUAGE_CHOICE } from '../i18n/locales';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Keeps a chosen language in the locale cookie, so the site stays in it
 * after sign-out (signed in, the account's own locale wins). While no
 * language is offered to choose (R-180) there is no choice to keep, and a
 * cookie set before stays as it is.
 */
export async function rememberLocale(locale: Locale): Promise<void> {
  if (!OFFERS_LANGUAGE_CHOICE) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  });
}
