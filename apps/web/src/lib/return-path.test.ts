import { describe, expect, it } from 'vitest';
import { onboardingPath, returnPath, signInPath } from './return-path';

const TOKEN = 'A'.repeat(42) + '_';

describe('returnPath (open-redirect guard)', () => {
  it('keeps an invite path', () => {
    expect(returnPath(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
  });

  it.each([
    ['an absolute URL', `https://evil.example/invite/${TOKEN}`],
    ['a protocol-relative URL', `//evil.example/invite/${TOKEN}`],
    ['a backslash', `/\\evil.example/invite/${TOKEN}`],
    ['an encoded slash', `/invite%2F${TOKEN}`],
    ['a dot segment', `/invite/../${TOKEN}`],
    ['a query', `/invite/${TOKEN}?x=1`],
    ['a fragment', `/invite/${TOKEN}#x`],
    ['a trailing slash', `/invite/${TOKEN}/`],
    ['another page', '/settings'],
    ['the bare prefix', '/invite/'],
    ['a short token', `/invite/${TOKEN.slice(1)}`],
    ['a long token', `/invite/${TOKEN}A`],
    ['a token with a dot', `/invite/${'A'.repeat(42)}.`],
    ['a non-string', 42],
    ['nothing', null],
    ['undefined', undefined],
  ])('drops %s', (_, raw) => {
    expect(returnPath(raw)).toBeNull();
  });
});

describe('signInPath / onboardingPath', () => {
  it('carry a kept path as ?next=', () => {
    expect(signInPath(`/invite/${TOKEN}`)).toBe(
      `/sign-in?next=%2Finvite%2F${TOKEN}`,
    );
    expect(onboardingPath(`/invite/${TOKEN}`)).toBe(
      `/welcome?next=%2Finvite%2F${TOKEN}`,
    );
  });

  it('are the plain pages without one', () => {
    expect(signInPath(null)).toBe('/sign-in');
    expect(onboardingPath(null)).toBe('/welcome');
  });
});
