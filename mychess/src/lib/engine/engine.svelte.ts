// mychess/src/lib/engine/engine.svelte.ts
//
// The shared Stockfish worker and its latest score, extracted out of
// EngineEval.svelte's module block so more than one component can read the
// same evaluation: the toggle/number card and the board-side eval bar are
// separate components in separate parts of the layout, and both need the
// score without spawning a second ~7MB WASM engine.
import { parseInfoLine, sideToMoveFromFen, toWhiteRelative, type EngineScore } from './uci';

// The URL fragment tells the emscripten bootstrap where to find the .wasm
// binary. A trailing `,worker` marks this load as a *nested* worker spawned by
// an already-running engine (used internally by multi-threaded builds) — the
// bootstrap's top-level dispatch short-circuits on that marker and never wires
// up `onmessage` or loads the engine, so the handshake sent below silently goes
// nowhere. This is the first, top-level worker, so no suffix here.
const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm';
const MOVETIME_MS = 400;
// If the engine never completes its uci/isready handshake within this window
// (WASM instantiation stalling, a network hiccup fetching the ~7MB binary, or
// anything else going wrong at startup), give up and show "unavailable" rather
// than sitting on the loading state forever with no visible signal.
const HANDSHAKE_TIMEOUT_MS = 8000;

export const engineState = $state<{ ready: boolean; failed: boolean; score: EngineScore | null }>({
	ready: false,
	failed: false,
	score: null
});

let worker: Worker | null = null;
let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
// Plain (non-reactive) — only ever read/written by the request functions, and
// never needs to trigger a re-render itself.
let lastRequestedFen = '';
// How many components are currently mounted against this engine — only a real
// unmount of the last one (navigating away) tears the worker down. Switching
// the preference off while still mounted goes through teardownEngine().
let instanceCount = 0;

function send(cmd: string) {
	worker?.postMessage(cmd);
}

function handleMessage(event: MessageEvent<string>) {
	const line = event.data;
	if (!engineState.ready) {
		if (line.includes('uciok')) send('isready');
		else if (line.includes('readyok')) {
			engineState.ready = true;
			clearTimeout(handshakeTimeout);
		}
		return;
	}
	const parsed = parseInfoLine(line);
	if (!parsed) return;
	engineState.score = toWhiteRelative(parsed.score, sideToMoveFromFen(lastRequestedFen));
}

function fail() {
	engineState.failed = true;
	clearTimeout(handshakeTimeout);
	worker?.terminate();
	worker = null;
}

/** Spawns the shared Worker once, the first time it's needed. */
export function ensureEngine() {
	if (worker || engineState.failed) return;
	if (typeof Worker === 'undefined') {
		fail();
		return;
	}
	try {
		worker = new Worker(ENGINE_URL);
		worker.onmessage = handleMessage;
		worker.onerror = fail;
		handshakeTimeout = setTimeout(fail, HANDSHAKE_TIMEOUT_MS);
		send('uci');
	} catch {
		fail();
	}
}

/**
 * A deliberate stop (the user switched the toggle off), distinct from fail() —
 * resets `failed` too, so switching back on gets a clean retry rather than
 * being stuck behind ensureEngine()'s `if (failed) return`.
 */
export function teardownEngine() {
	clearTimeout(handshakeTimeout);
	if (worker) {
		send('quit');
		worker.terminate();
	}
	worker = null;
	engineState.ready = false;
	engineState.failed = false;
	engineState.score = null;
	lastRequestedFen = '';
}

/** Requests a fresh eval only if `nextFen` isn't already the last one requested. */
export function requestIfDue(nextFen: string) {
	if (!engineState.ready || !nextFen || nextFen === lastRequestedFen) return;
	lastRequestedFen = nextFen;
	engineState.score = null;
	// "stop" is safe to send even when nothing is searching — sent
	// unconditionally so a burst of rapid fen changes (e.g. the autoplay intro)
	// never leaves a stale search about to overwrite a newer one.
	send('stop');
	send(`position fen ${nextFen}`);
	send(`go movetime ${MOVETIME_MS}`);
}

/** Registers a mounted consumer; returns the release function for onDestroy. */
export function retainEngine(): () => void {
	instanceCount++;
	return () => {
		instanceCount--;
		if (instanceCount > 0) return;
		teardownEngine();
	};
}
