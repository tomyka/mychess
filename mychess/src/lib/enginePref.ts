// mychess/src/lib/enginePref.ts
// Whether the Stockfish eval sidebar is allowed to spawn its Worker at
// all — disabled by default, since it downloads a ~7MB WASM binary on
// mount purely for a nice-to-have feature.

export const ENGINE_PREF_COOKIE_NAME = 'engine_enabled';

/** Parses a raw cookie string for the engine preference — defaults to disabled for anything absent/malformed. */
export function parseEnginePrefCookie(cookieString: string): boolean {
	const match = cookieString.match(new RegExp(`(?:^|;\\s*)${ENGINE_PREF_COOKIE_NAME}=([^;]*)`));
	return match?.[1] === 'true';
}

/** The `document.cookie` assignment string for persisting the preference — long-lived (1 year), root-scoped. */
export function enginePrefCookieString(enabled: boolean): string {
	const oneYearInSeconds = 60 * 60 * 24 * 365;
	return `${ENGINE_PREF_COOKIE_NAME}=${enabled}; path=/; max-age=${oneYearInSeconds}; SameSite=Lax`;
}
