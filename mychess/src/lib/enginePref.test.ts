import { describe, it, expect } from 'vitest';
import {
	parseEnginePrefCookie,
	enginePrefCookieString,
	legacyEnginePrefClearString,
	ENGINE_PREF_COOKIE_NAME,
	LEGACY_ENGINE_PREF_COOKIE_NAME
} from './enginePref';

describe('parseEnginePrefCookie', () => {
	it('defaults to disabled when the cookie is entirely absent', () => {
		expect(parseEnginePrefCookie('')).toBe(false);
	});

	it('defaults to disabled when other cookies exist but not this one', () => {
		expect(parseEnginePrefCookie('foo=bar; baz=qux')).toBe(false);
	});

	it('reads an explicit true value', () => {
		expect(parseEnginePrefCookie(`${ENGINE_PREF_COOKIE_NAME}=true`)).toBe(true);
	});

	it('reads an explicit false value', () => {
		expect(parseEnginePrefCookie(`${ENGINE_PREF_COOKIE_NAME}=false`)).toBe(false);
	});

	it('finds the cookie among others regardless of position', () => {
		expect(parseEnginePrefCookie(`foo=bar; ${ENGINE_PREF_COOKIE_NAME}=true; baz=qux`)).toBe(true);
	});

	it('defaults to disabled for an unrecognized value', () => {
		expect(parseEnginePrefCookie(`${ENGINE_PREF_COOKIE_NAME}=yes`)).toBe(false);
	});
});

describe('enginePrefCookieString', () => {
	it('includes the cookie name and chosen value', () => {
		expect(enginePrefCookieString(true)).toContain(`${ENGINE_PREF_COOKIE_NAME}=true`);
		expect(enginePrefCookieString(false)).toContain(`${ENGINE_PREF_COOKIE_NAME}=false`);
	});

	it('is root-scoped and long-lived', () => {
		const cookie = enginePrefCookieString(true);
		expect(cookie).toContain('path=/');
		expect(cookie).toContain('max-age=31536000');
	});
});

describe('the retired pre-rework cookie', () => {
	// "Off by default" was already true for a NEW visitor; what kept the engine
	// on was a year-long engine_enabled=true from an earlier session. The rename
	// is what makes the default apply to existing sessions too.
	it('is a different name from the current one', () => {
		expect(LEGACY_ENGINE_PREF_COOKIE_NAME).not.toBe(ENGINE_PREF_COOKIE_NAME);
	});

	it('does not enable the engine, whatever it says', () => {
		expect(parseEnginePrefCookie(`${LEGACY_ENGINE_PREF_COOKIE_NAME}=true`)).toBe(false);
	});

	it('is cleared by an expiring, root-scoped assignment', () => {
		const cookie = legacyEnginePrefClearString();
		expect(cookie).toContain(`${LEGACY_ENGINE_PREF_COOKIE_NAME}=;`);
		expect(cookie).toContain('max-age=0');
		expect(cookie).toContain('path=/');
	});
});
