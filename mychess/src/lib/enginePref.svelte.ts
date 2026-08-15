// mychess/src/lib/enginePref.svelte.ts
import { parseEnginePrefCookie, enginePrefCookieString } from './enginePref';

/** Shared across the whole app — the root layout reads it once at load, the Settings toggle and the Practice page both read/write it. */
export const enginePrefStore = $state<{ enabled: boolean }>({ enabled: false });

// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR.
export function initEnginePrefFromCookie() {
	enginePrefStore.enabled = typeof document !== 'undefined' ? parseEnginePrefCookie(document.cookie) : false;
}

// Client-only: call from $effect/onMount/event handlers, never from server code or component top-level during SSR.
export function setEnginePref(enabled: boolean) {
	enginePrefStore.enabled = enabled;
	if (typeof document !== 'undefined') document.cookie = enginePrefCookieString(enabled);
}
