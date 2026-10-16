import { describe, expect, it } from 'vitest';
import { linkWithLocale, signUpLocale } from './sign-up-locale';

const VERIFY = 'http://localhost:3000/api/auth/magic-link/verify?token=t';

// The endpoint context Better Auth hands a database hook.
const ctx = (url: string, cookie?: string) => ({
  request: new Request(url),
  headers: new Headers(cookie === undefined ? {} : { cookie }),
});

describe('signUpLocale (R-85)', () => {
  it('takes the language a magic link carries over the cookie', () => {
    expect(signUpLocale(ctx(`${VERIFY}&lang=en`, 'NEXT_LOCALE=lt'))).toBe('en');
  });

  it('takes the locale cookie when the link carries none', () => {
    expect(signUpLocale(ctx(VERIFY, 'a=1; NEXT_LOCALE=en; b=2'))).toBe('en');
  });

  it.each([
    ['an unknown link language', `${VERIFY}&lang=de`, 'NEXT_LOCALE=en', 'en'],
    ['an unknown cookie language', VERIFY, 'NEXT_LOCALE=de', 'lt'],
    ['no cookie', VERIFY, undefined, 'lt'],
  ])('with %s falls back', (_, url, cookie, locale) => {
    expect(signUpLocale(ctx(url, cookie))).toBe(locale);
  });

  it('is Lithuanian with no request at all', () => {
    expect(signUpLocale(null)).toBe('lt');
    expect(signUpLocale({})).toBe('lt');
  });
});

describe('linkWithLocale', () => {
  it('adds the language to the link', () => {
    expect(linkWithLocale(VERIFY, 'en')).toBe(`${VERIFY}&lang=en`);
  });

  it('leaves the link alone with no language', () => {
    expect(linkWithLocale(VERIFY, undefined)).toBe(VERIFY);
  });
});
