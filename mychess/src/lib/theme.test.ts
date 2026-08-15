import { describe, it, expect } from 'vitest';
import { parseThemeCookie, resolveTheme, themeCookieString, THEME_COOKIE_NAME } from './theme';

describe('parseThemeCookie', () => {
	it('defaults to dark when the cookie is entirely absent', () => {
		expect(parseThemeCookie('')).toBe('dark');
	});

	it('defaults to dark when other cookies exist but not theme', () => {
		expect(parseThemeCookie('foo=bar; baz=qux')).toBe('dark');
	});

	it('reads an explicit light value', () => {
		expect(parseThemeCookie('theme=light')).toBe('light');
	});

	it('reads an explicit dark value', () => {
		expect(parseThemeCookie('theme=dark')).toBe('dark');
	});

	it('reads an explicit system value', () => {
		expect(parseThemeCookie('theme=system')).toBe('system');
	});

	it('finds theme among other cookies regardless of position', () => {
		expect(parseThemeCookie('foo=bar; theme=light; baz=qux')).toBe('light');
		expect(parseThemeCookie('theme=system; foo=bar')).toBe('system');
	});

	it('defaults to dark for an unrecognized value', () => {
		expect(parseThemeCookie('theme=blue')).toBe('dark');
	});
});

describe('resolveTheme', () => {
	it('resolves system to light when the OS prefers light', () => {
		expect(resolveTheme('system', true)).toBe('light');
	});

	it('resolves system to dark when the OS does not prefer light', () => {
		expect(resolveTheme('system', false)).toBe('dark');
	});

	it('passes dark through unchanged regardless of OS preference', () => {
		expect(resolveTheme('dark', true)).toBe('dark');
		expect(resolveTheme('dark', false)).toBe('dark');
	});

	it('passes light through unchanged regardless of OS preference', () => {
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('light', false)).toBe('light');
	});
});

describe('themeCookieString', () => {
	it('includes the cookie name and chosen value', () => {
		expect(themeCookieString('light')).toContain(`${THEME_COOKIE_NAME}=light`);
	});

	it('is root-scoped and long-lived', () => {
		const cookie = themeCookieString('dark');
		expect(cookie).toContain('path=/');
		expect(cookie).toContain('max-age=31536000');
	});
});
