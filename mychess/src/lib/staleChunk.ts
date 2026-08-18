// mychess/src/lib/staleChunk.ts
//
// Recovery from the one failure mode a redeploy reliably causes: a tab (or a
// service-worker-cached app shell) still running the PREVIOUS build asks for a
// route chunk by its old content hash, and that file no longer exists.
//
// Every push to main redeploys, and `sw.js` (@vite-pwa/sveltekit, registerType
// 'autoUpdate') precaches the app shell — so a visitor can be served last
// build's shell, whose chunk hashes died with it. Observed in production as:
//
//   TypeError: Failed to fetch dynamically imported module:
//   .../_app/immutable/nodes/11.iACMe__D.js        (404)
//
// `kit.version.pollInterval` (svelte.config.js) already covers client-side
// NAVIGATION — SvelteKit falls back to a full page load when a route module
// fails to import mid-navigation. What it does not cover is the INITIAL load:
// the shell is already running, its own route chunk 404s, and there's no
// navigation to fall back to. That reaches `handleError` and renders the error
// page for what is really just a cache one deploy behind.

/** sessionStorage key marking that a reload has already been attempted this session. */
const RELOAD_FLAG = 'mychess:stale-chunk-reload';

/**
 * Whether this error is a route chunk that failed to load, as opposed to a
 * genuine application error.
 *
 * Matched on message text because that is all the platforms agree on — each
 * engine words it differently and none of them expose a type or code to check
 * instead (Chrome/Edge: "Failed to fetch dynamically imported module", Firefox:
 * "error loading dynamically imported module", Safari: "Importing a module
 * script failed"). All three are reported here so a fix verified in one browser
 * isn't silently absent in another.
 */
export function isStaleChunkError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
		message
	);
}

/**
 * Decides what to do about `error`, without performing it — the decision is
 * separated from `location.reload()` purely so it can be tested.
 *
 * Reloads at most once per session. A second identical failure means reloading
 * didn't help (the chunk is genuinely missing, an incomplete deploy, or the
 * user is offline), and looping on it would leave them staring at a blank
 * flashing page with no way to read what went wrong. Better to fall through to
 * the error page and say so.
 */
export function staleChunkAction(error: unknown, alreadyReloaded: boolean): 'reload' | 'report' {
	if (!isStaleChunkError(error)) return 'report';
	return alreadyReloaded ? 'report' : 'reload';
}

/**
 * Reloads the page if `error` is a stale chunk and we haven't already tried.
 * Returns true when a reload was triggered, so the caller can return a message
 * suited to a page that's about to disappear.
 *
 * The reload is expected to be served by the NEW service worker: registering
 * `sw.js` on this load already fetched it, and 'autoUpdate' takes over the
 * client immediately (skipWaiting/clientsClaim), so the next load gets the
 * current precache rather than the one that just failed.
 */
export function recoverFromStaleChunk(error: unknown): boolean {
	let alreadyReloaded = false;
	try {
		alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) !== null;
	} catch {
		// Private-mode/blocked storage: treat as "not yet reloaded". A reload
		// loop is still bounded — without storage we can't remember, but the
		// only way to get here twice is for the chunk to keep 404ing, which
		// means the deploy is broken in a way a reload can't fix either way.
	}

	if (staleChunkAction(error, alreadyReloaded) === 'report') return false;

	try {
		sessionStorage.setItem(RELOAD_FLAG, '1');
	} catch {
		// Ignored for the reason above.
	}
	location.reload();
	return true;
}

/**
 * Clears the once-per-session guard. Called from the root layout once the app
 * has actually rendered, so a LATER deploy in the same long-lived session gets
 * its own recovery attempt instead of inheriting a spent one.
 */
export function clearStaleChunkGuard(): void {
	try {
		sessionStorage.removeItem(RELOAD_FLAG);
	} catch {
		// Nothing to clear if storage is unavailable.
	}
}
