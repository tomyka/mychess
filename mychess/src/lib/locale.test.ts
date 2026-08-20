import { describe, it, expect } from 'vitest';
import { isSupportedLocale } from './locale';

describe('isSupportedLocale', () => {
	it('accepts en and lt', () => {
		expect(isSupportedLocale('en')).toBe(true);
		expect(isSupportedLocale('lt')).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isSupportedLocale('fr')).toBe(false);
		expect(isSupportedLocale('')).toBe(false);
		expect(isSupportedLocale(undefined)).toBe(false);
		expect(isSupportedLocale(null)).toBe(false);
		expect(isSupportedLocale(1)).toBe(false);
	});
});
