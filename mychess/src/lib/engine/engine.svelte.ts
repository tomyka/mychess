// mychess/src/lib/engine/engine.svelte.ts
//
// The shared Stockfish worker and its latest score. Kept out of any one
// component so the engine survives across the surfaces that show it and so a
// second ~7MB WASM instance can never be spawned. Verified against the served
// build: the worker completes its handshake and returns a first score in
// ~130ms, so a blank evaluation is this module's problem, never Stockfish's.
import { parseInfoLine, sideToMoveFromFen, toWhiteRelative, type EngineScore } from './uci';

// The URL fragment tells the emscripten bootstrap where to find the .wasm
// binary. A trailing `,worker` marks this load as a *nested* worker spawned by
// an already-running engine (used internally by multi-threaded builds) — the
// bootstrap's top-level dispatch short-circuits on that marker and never wires
// up `onmessage` or loads the engine, so the handshake sent below silently goes
// nowhere. This is the first, top-level worker, so no suffix here.

// The engine build, in one place: the .js bootstrap and the .wasm binary share
// this stem, and the bootstrap locates the wasm by basename — so swapping the
// build (#127) means dropping `<stem>.js` and `<stem>.wasm` into
// static/stockfish/ and changing this line.
const ENGINE_BASENAME = 'stockfish-18-lite-single';
const ENGINE_URL = `/stockfish/${ENGINE_BASENAME}.js#${ENGINE_BASENAME}.wasm`;
const MOVETIME_MS = 400;
// If the engine never completes its uci/isready handshake within this window
// (WASM instantiation stalling, a network hiccup fetching the ~7MB binary, or
// anything else going wrong at startup), give up and show "unavailable" rather
// than sitting on the loading state forever with no visible signal.
const HANDSHAKE_TIMEOUT_MS = 8000;

export const engineState = $state<{
	ready: boolean;
	failed: boolean;
	score: EngineScore | null;
	/** A search is in flight, so `score` still describes the PREVIOUS position. */
	searching: boolean;
}>({
	ready: false,
	failed: false,
	score: null,
	searching: false
});

/**
 * Whether the player has switched the engine on. Off by default, and off again
 * on every reload: analysis is something you ask for in explore mode, not a
 * thing that quietly follows you into drilling (see the #126 follow-up spec).
 *
 * An object rather than an exported `let` because a module-scope `let` cannot be
 * exported reactively — consumers read `engineEnabled.on`.
 *
 * Module-level, so it outlives any one component: closing explore unmounts the
 * bar (and with it the worker), but re-opening explore in the same visit — or
 * moving between Learn and Practice — finds the engine already switched on.
 */
export const engineEnabled = $state<{ on: boolean }>({ on: false });

/**
 * Switches the engine on or off; off stops the worker rather than just hiding it.
 *
 * Always switch off through here. Writing `engineEnabled.on = false` directly
 * skips the teardown and leaves a worker searching for a bar nobody can see.
 */
export function setEngineEnabled(on: boolean) {
	engineEnabled.on = on;
	if (!on) teardownEngine();
}

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
	engineState.searching = false;
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
	engineState.searching = false;
	lastRequestedFen = '';
}

/** Requests a fresh eval only if `nextFen` isn't already the last one requested. */
export function requestIfDue(nextFen: string) {
	if (!engineState.ready || !nextFen || nextFen === lastRequestedFen) return;
	lastRequestedFen = nextFen;
	// The previous score deliberately STAYS on screen until the new one lands.
	// Clearing it here is what made the evaluation look switched off: positions
	// change faster than a 400ms search finishes wherever moves play themselves
	// (the autoplay intro, an opponent reply after a correct move), so the bar
	// spent those stretches empty and only occasionally flashed a number.
	// `searching` lets the display say "this is the previous position's number"
	// without the number disappearing.
	engineState.searching = true;
	// "stop" is safe to send even when nothing is searching — sent
	// unconditionally so a burst of rapid fen changes never leaves a stale
	// search about to overwrite a newer one.
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
