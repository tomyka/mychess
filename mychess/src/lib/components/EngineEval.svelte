<!-- mychess/src/lib/components/EngineEval.svelte -->
<script module lang="ts">
	import {
		parseInfoLine,
		sideToMoveFromFen,
		toWhiteRelative,
		formatEval,
		evalBarWhiteFraction,
		type EngineScore
	} from '$lib/engine/uci';

	// The URL fragment tells the emscripten bootstrap where to find the
	// .wasm binary. A trailing `,worker` marks this load as a *nested*
	// worker spawned by an already-running engine (used internally by
	// multi-threaded builds) — the bootstrap's top-level dispatch short-
	// circuits on that marker and never wires up `onmessage` or loads the
	// engine, so the handshake this component sends silently goes
	// nowhere. This is the first, top-level worker, so no suffix here.
	const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm';
	const MOVETIME_MS = 400;
	// If the engine never completes its uci/isready handshake within this
	// window (WASM instantiation stalling, a network hiccup fetching the
	// ~7MB binary, or anything else going wrong at startup), give up and
	// show "unavailable" instead of sitting on the loading state forever
	// with no visible signal that anything's wrong.
	const HANDSHAKE_TIMEOUT_MS = 8000;
	let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;

	// Module-level singleton: the Practice page mounts both a desktop and a
	// mobile <EngineEval> simultaneously (visibility is CSS-only, via
	// Tailwind's `hidden`/`lg:` classes — both are always actually in the
	// DOM), so sharing one Worker/search here avoids spawning two ~7MB
	// WASM engines running duplicate searches for the same position.
	let worker: Worker | null = null;
	let ready = $state(false);
	let failed = $state(false);
	let score = $state<EngineScore | null>(null);
	// Plain (non-reactive) — only ever read/written from requestEval and
	// requestIfDue, never needs to itself trigger a re-run.
	let lastRequestedFen = '';
	// How many EngineEval instances are currently mounted — used only to
	// decide whether a real unmount (navigating away) should tear down the
	// Worker; turning the preference off/on while still mounted is handled
	// separately by teardownWorker()/ensureWorker() below.
	let instanceCount = 0;

	function send(cmd: string) {
		worker?.postMessage(cmd);
	}

	function requestEval(nextFen: string) {
		lastRequestedFen = nextFen;
		score = null;
		// "stop" is safe to send even when nothing is searching — sent
		// unconditionally so a burst of rapid fen changes (e.g. the practice
		// page's autoplay intro) never leaves a stale search about to
		// overwrite a newer one.
		send('stop');
		send(`position fen ${nextFen}`);
		send(`go movetime ${MOVETIME_MS}`);
	}

	function handleMessage(event: MessageEvent<string>) {
		const line = event.data;
		if (!ready) {
			if (line.includes('uciok')) send('isready');
			else if (line.includes('readyok')) {
				ready = true;
				clearTimeout(handshakeTimeout);
			}
			return;
		}
		const parsed = parseInfoLine(line);
		if (!parsed) return;
		score = toWhiteRelative(parsed.score, sideToMoveFromFen(lastRequestedFen));
	}

	function fail() {
		failed = true;
		clearTimeout(handshakeTimeout);
		worker?.terminate();
		worker = null;
	}

	/** Spawns the shared Worker once, the first time it's needed. */
	function ensureWorker() {
		if (worker || failed) return;
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
	 * A deliberate stop (the user switched the toggle off), distinct from
	 * fail() — resets `failed` too, so switching back on gets a clean retry
	 * rather than being stuck behind ensureWorker()'s `if (failed) return`.
	 */
	function teardownWorker() {
		clearTimeout(handshakeTimeout);
		if (worker) {
			send('quit');
			worker.terminate();
		}
		worker = null;
		ready = false;
		failed = false;
		score = null;
		lastRequestedFen = '';
	}

	/** Requests a fresh eval only if `nextFen` isn't already the last one requested. */
	function requestIfDue(nextFen: string) {
		if (ready && nextFen && nextFen !== lastRequestedFen) requestEval(nextFen);
	}
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { enginePrefStore, setEnginePref } from '$lib/enginePref.svelte';

	let { fen }: { fen: string } = $props();

	onMount(() => {
		instanceCount++;
	});

	onDestroy(() => {
		instanceCount--;
		if (instanceCount > 0) return;
		teardownWorker();
	});

	// Spawns the engine as soon as the preference is on (including at
	// mount, if it was already enabled from a prior session) and tears it
	// down the moment it's switched off — not just on unmount.
	$effect(() => {
		if (enginePrefStore.enabled) ensureWorker();
		else teardownWorker();
	});

	// Fires once at mount time once `ready` flips true (re-evaluating the
	// fen already present at that point), and again on every later fen
	// change — a single code path for both cases. Shared `lastRequestedFen`
	// means whichever instance's effect runs first for a given fen actually
	// requests it; the other instance(s)' effect is then a same-fen no-op.
	$effect(() => {
		requestIfDue(fen);
	});

	const displayText = $derived(score ? formatEval(score) : '…');
	const whiteFraction = $derived(score ? evalBarWhiteFraction(score) : null);
</script>

<div class="flex items-center gap-2">
	<button
		type="button"
		role="switch"
		aria-checked={enginePrefStore.enabled}
		aria-label="Toggle engine evaluation"
		onclick={() => setEnginePref(!enginePrefStore.enabled)}
		class="relative w-9 h-5 rounded-full shrink-0 transition-colors {enginePrefStore.enabled
			? 'bg-green-500'
			: 'bg-(--color-border)'}"
	>
		<span
			class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm flex items-center justify-center transition-transform {enginePrefStore.enabled
				? 'translate-x-4'
				: ''}"
		>
			{#if enginePrefStore.enabled}
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-2.5 h-2.5 text-green-600" aria-hidden="true">
					<path
						fill-rule="evenodd"
						d="M16.704 5.29a1 1 0 010 1.415l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.415L8.75 11.836l6.543-6.543a1 1 0 011.411-.003z"
						clip-rule="evenodd"
					/>
				</svg>
			{/if}
		</span>
	</button>
	{#if enginePrefStore.enabled}
		{#if failed}
			<span class="text-sm text-(--color-muted) italic">unavailable</span>
		{:else}
			<span class="text-base font-bold text-(--color-text) tabular-nums shrink-0">{displayText}</span>
			{#if whiteFraction !== null}
				<div class="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden" aria-hidden="true">
					<div class="h-full bg-white" style={`width: ${whiteFraction * 100}%`}></div>
				</div>
			{/if}
		{/if}
	{/if}
</div>
