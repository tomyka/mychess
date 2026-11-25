import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, parseTheme, themeAttribute } from './theme';

describe('parseTheme', () => {
  it.each(['system', 'light', 'dark'] as const)('keeps %s', (value) => {
    expect(parseTheme(value)).toBe(value);
  });

  it.each([undefined, '', 'sepia', 'LIGHT'])('reads %s as system', (value) => {
    expect(parseTheme(value)).toBe('system');
  });
});

describe('themeAttribute', () => {
  it('sets data-theme only for a chosen theme', () => {
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

it('names the cookie theme', () => {
  expect(THEME_COOKIE).toBe('theme');
});
