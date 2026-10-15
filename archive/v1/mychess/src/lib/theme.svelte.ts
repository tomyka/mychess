// mychess/src/lib/theme.svelte.ts
import { parseThemeCookie, resolveTheme, themeCookieString, type Theme } from './theme';

/**
 * Shared across the whole app — the root layout's live system-preference
 * listener and the Settings page's toggle both read/write this. The single
 * source of truth for the CURRENTLY selected theme option on this page
 * load. Starts at 'dark' (matching the app default) until
 * initThemeFromCookie() runs, which the root layout does immediately —
 * matching the blocking inline script in app.html that already set the
 * initial <html> class from the same cookie, so there's no mismatch
 * between what's already painted and this store's starting value.
 */
export const themeStore = $state<{ current: Theme }>({ current: 'dark' });

// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR — themeStore is a module-level singleton shared across all requests on the server process.
export function initThemeFromCookie() {
	themeStore.current = typeof document !== 'undefined' ? parseThemeCookie(document.cookie) : 'dark';
}

export function applyResolvedThemeClass(theme: Theme) {
	if (typeof document === 'undefined') return;
	const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
	document.documentElement.classList.toggle('dark', resolveTheme(theme, prefersLight) === 'dark');
}

/** Persists the choice (cookie), updates the shared store, and applies it immediately — no reload. */
// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR — themeStore is a module-level singleton shared across all requests on the server process.
export function setTheme(theme: Theme) {
	themeStore.current = theme;
	if (typeof document !== 'undefined') document.cookie = themeCookieString(theme);
	applyResolvedThemeClass(theme);
}
