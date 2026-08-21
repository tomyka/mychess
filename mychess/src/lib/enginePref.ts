// mychess/src/lib/enginePref.ts
// Whether the Stockfish eval sidebar is allowed to spawn its Worker at
// all — disabled by default, since it downloads a ~7MB WASM binary on
// mount purely for a nice-to-have feature.

export const ENGINE_PREF_COOKIE_NAME = 'engine_eval';

/**
 * The name this preference used until the engine UI was reworked. Retired
 * rather than read: "off by default" was already true for a new visitor, but a
 * year-long `engine_enabled=true` from an earlier session kept the engine on
 * for everyone who had ever switched it on, which is exactly what looked like a
 * wrong default. Existing sessions therefore start off once under the new name,
 * and the stale cookie is cleared (see `legacyEnginePrefClearString`) instead of
 * being left to expire on its own.
 */
export const LEGACY_ENGINE_PREF_COOKIE_NAME = 'engine_enabled';

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

/** The `document.cookie` assignment that deletes the retired pre-rework cookie. */
export function legacyEnginePrefClearString(): string {
	return `${LEGACY_ENGINE_PREF_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}
