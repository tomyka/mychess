import { DEFAULT_LOCALE, LOCALES, type Locale } from '@mychess/domain';
import en from './messages/en.json';
import lt from './messages/lt.json';

/** The cookie a visitor's language choice is kept in (next-intl's name). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Every language's message catalogue; lt.json is the reference shape. */
export const MESSAGES: Record<Locale, typeof lt> = { lt, en };

function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** The locale a cookie's value names, or Lithuanian for anything else. */
export function resolveLocale(value: string | undefined): Locale {
  return value !== undefined && isLocale(value) ? value : DEFAULT_LOCALE;
}
