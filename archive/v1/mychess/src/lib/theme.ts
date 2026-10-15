// mychess/src/lib/theme.ts

export type Theme = 'dark' | 'light' | 'system';

export const THEME_COOKIE_NAME = 'theme';

/**
 * Parses a raw cookie string (document.cookie, or a request's Cookie
 * header) for the theme cookie — defaults to 'dark' for anything absent,
 * empty, or holding an unrecognized value, matching this app's
 * dark-by-default policy.
 */
export function parseThemeCookie(cookieString: string): Theme {
	const match = cookieString.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE_NAME}=([^;]*)`));
	const value = match?.[1];
	if (value === 'light' || value === 'dark' || value === 'system') return value;
	return 'dark';
}

/** Resolves 'system' against the OS's own light/dark preference; 'dark'/'light' pass through unchanged. */
export function resolveTheme(theme: Theme, prefersLight: boolean): 'dark' | 'light' {
	if (theme === 'system') return prefersLight ? 'light' : 'dark';
	return theme;
}

/** The `document.cookie` assignment string for persisting a theme choice — long-lived (1 year), root-scoped. */
export function themeCookieString(theme: Theme): string {
	const oneYearInSeconds = 60 * 60 * 24 * 365;
	return `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${oneYearInSeconds}; SameSite=Lax`;
}
