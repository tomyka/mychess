import { LOCALES, type Locale } from '@mychess/domain';
import en from './messages/en.json';
import lt from './messages/lt.json';

/** The cookie a visitor's language choice is kept in (next-intl's name). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Every language's message catalogue; lt.json is the reference shape. */
export const MESSAGES: Record<Locale, typeof lt> = { lt, en };

/**
 * The languages the site is served in, the first the fallback. R-180: the
 * UI is English only for now; an account's stored locale and the locale
 * cookie are kept as they are but not rendered. Lithuanian comes back by
 * putting 'lt' first here: pages, mail, opening and chapter names, PGN
 * file names and the language choice in onboarding and settings all follow.
 */
export const OFFERED_LOCALES: readonly [Locale, ...Locale[]] = ['en'];

/** Is there a language to choose (onboarding, settings)? */
export const OFFERS_LANGUAGE_CHOICE = OFFERED_LOCALES.length > 1;

/** Is `value` one of the site's languages (a stored locale's set)? */
export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/**
 * The language a page, mail or name is served in for `wanted` (an
 * account's stored locale or a cookie's value): `wanted` when it is
 * offered, else the first offered language.
 */
export function resolveLocale(wanted: string | undefined): Locale {
  const offered = OFFERED_LOCALES.find((locale) => locale === wanted);
  return offered ?? OFFERED_LOCALES[0];
}
