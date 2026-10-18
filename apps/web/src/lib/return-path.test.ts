import { describe, expect, it } from 'vitest';
import { onboardingPath, returnPath, signInPath } from './return-path';

const TOKEN = 'A'.repeat(42) + '_';

describe('returnPath (open-redirect guard)', () => {
  it('keeps an invite path', () => {
    expect(returnPath(`/k/${TOKEN}`)).toBe(`/k/${TOKEN}`);
  });

  it.each([
    ['an absolute URL', `https://evil.example/k/${TOKEN}`],
    ['a protocol-relative URL', `//evil.example/k/${TOKEN}`],
    ['a backslash', `/\\evil.example/k/${TOKEN}`],
    ['an encoded slash', `/k%2F${TOKEN}`],
    ['a dot segment', `/k/../${TOKEN}`],
    ['a query', `/k/${TOKEN}?x=1`],
    ['a fragment', `/k/${TOKEN}#x`],
    ['a trailing slash', `/k/${TOKEN}/`],
    ['another page', '/nustatymai'],
    ['the bare prefix', '/k/'],
    ['a short token', `/k/${TOKEN.slice(1)}`],
    ['a long token', `/k/${TOKEN}A`],
    ['a token with a dot', `/k/${'A'.repeat(42)}.`],
    ['a non-string', 42],
    ['nothing', null],
    ['undefined', undefined],
  ])('drops %s', (_, raw) => {
    expect(returnPath(raw)).toBeNull();
  });
});

describe('signInPath / onboardingPath', () => {
  it('carry a kept path as ?next=', () => {
    expect(signInPath(`/k/${TOKEN}`)).toBe(`/prisijungti?next=%2Fk%2F${TOKEN}`);
    expect(onboardingPath(`/k/${TOKEN}`)).toBe(`/pradzia?next=%2Fk%2F${TOKEN}`);
  });

  it('are the plain pages without one', () => {
    expect(signInPath(null)).toBe('/prisijungti');
    expect(onboardingPath(null)).toBe('/pradzia');
  });
});
