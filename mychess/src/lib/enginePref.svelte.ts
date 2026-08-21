// mychess/src/lib/enginePref.svelte.ts
import { parseEnginePrefCookie, enginePrefCookieString, legacyEnginePrefClearString } from './enginePref';

/** Shared across the whole app — the root layout reads it once at load, the Settings toggle and the Practice page both read/write it. */
export const enginePrefStore = $state<{ enabled: boolean }>({ enabled: false });

// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR.
export function initEnginePrefFromCookie() {
	if (typeof document === 'undefined') {
		enginePrefStore.enabled = false;
		return;
	}
	enginePrefStore.enabled = parseEnginePrefCookie(document.cookie);
	// Drop the retired cookie on the way past, so it stops sitting in the jar for
	// the rest of its year. Nothing reads it any more (see enginePref.ts).
	document.cookie = legacyEnginePrefClearString();
}

// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR.
export function setEnginePref(enabled: boolean) {
	enginePrefStore.enabled = enabled;
	if (typeof document !== 'undefined') document.cookie = enginePrefCookieString(enabled);
}
