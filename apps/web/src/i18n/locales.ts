import en from './messages/en.json';
import lt from './messages/lt.json';

/** The site's languages: Lithuanian first, English beside it. */
const LOCALES = ['lt', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'lt';

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
