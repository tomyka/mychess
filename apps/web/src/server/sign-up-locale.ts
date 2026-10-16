import type { Locale } from '@mychess/domain';
import { parseCookies } from 'better-auth/cookies';
import { isLocale, LOCALE_COOKIE, resolveLocale } from '../i18n/locales';

/** The magic-link query parameter that carries the asking page's language. */
const LINK_LOCALE = 'lang';

/** What a Better Auth database hook knows of the request it runs in. */
export interface SignUpRequest {
  readonly request?: Request | undefined;
  readonly headers?: Headers | undefined;
}

const linkLocale = (request: Request | undefined): string | null =>
  request === undefined
    ? null
    : new URL(request.url).searchParams.get(LINK_LOCALE);

const cookieLocale = (headers: Headers | undefined): string | undefined => {
  const cookie = headers?.get('cookie') ?? undefined;
  return cookie === undefined
    ? undefined
    : parseCookies(cookie).get(LOCALE_COOKIE);
};

/**
 * The language a new account starts in (R-85): the one the sign-in page
 * was in when it asked for the magic link, which the link carries so it
 * holds on another device; else the locale cookie of the browser that
 * finishes the sign-in (the OAuth callback carries it); else Lithuanian.
 */
export function signUpLocale(ctx: SignUpRequest | null): Locale {
  const fromLink = linkLocale(ctx?.request);
  if (fromLink !== null && isLocale(fromLink)) return fromLink;
  return resolveLocale(cookieLocale(ctx?.headers));
}

/** The magic link with the asking page's language on it, when known. */
export function linkWithLocale(
  url: string,
  locale: Locale | undefined,
): string {
  if (locale === undefined) return url;
  const link = new URL(url);
  link.searchParams.set(LINK_LOCALE, locale);
  return link.href;
}
