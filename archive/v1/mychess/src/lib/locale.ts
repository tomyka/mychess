export type Locale = 'en' | 'lt';

export function isSupportedLocale(value: unknown): value is Locale {
	return value === 'en' || value === 'lt';
}
