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

	const ENGINE_URL = '/stockfish/stockfish-18-lite-single.js#stockfish-18-lite-single.wasm,worker';
	const MOVETIME_MS = 400;

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
	// How many EngineEval instances are currently mounted — the Worker is
	// only spawned once (by whichever instance mounts first) and only torn
	// down once every instance has unmounted.
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
			else if (line.includes('readyok')) ready = true;
			return;
		}
		const parsed = parseInfoLine(line);
		if (!parsed) return;
		score = toWhiteRelative(parsed.score, sideToMoveFromFen(lastRequestedFen));
	}

	function fail() {
		failed = true;
		worker?.terminate();
		worker = null;
	}

	/** Spawns the shared Worker once, the first time any instance mounts. */
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
			send('uci');
		} catch {
			fail();
		}
	}

	/** Requests a fresh eval only if `nextFen` isn't already the last one requested. */
	function requestIfDue(nextFen: string) {
		if (ready && nextFen && nextFen !== lastRequestedFen) requestEval(nextFen);
	}
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let { fen }: { fen: string } = $props();

	onMount(() => {
		instanceCount++;
		ensureWorker();
	});

	onDestroy(() => {
		instanceCount--;
		if (instanceCount > 0) return;
		if (worker) {
			send('quit');
			worker.terminate();
		}
		worker = null;
		ready = false;
		failed = false;
		score = null;
		lastRequestedFen = '';
	});

	// Fires once at mount time once `ready` flips true (re-evaluating the
	// fen already present at that point), and again on every later fen
	// change — a single code path for both cases. Shared `lastRequestedFen`
	// means whichever instance's effect runs first for a given fen actually
	// requests it; the other instance(s)' effect is then a same-fen no-op.
	$effect(() => {
		requestIfDue(fen);
	});

	const displayText = $derived(failed ? null : score ? formatEval(score) : '…');
	const whiteFraction = $derived(score ? evalBarWhiteFraction(score) : null);
</script>

{#if displayText}
	<div class="flex items-center gap-2">
		<span class="text-xs font-semibold uppercase tracking-wide text-gray-400 shrink-0">Eval</span>
		<span class="text-base font-bold text-gray-900 tabular-nums shrink-0">{displayText}</span>
		{#if whiteFraction !== null}
			<div class="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden" aria-hidden="true">
				<div class="h-full bg-white" style={`width: ${whiteFraction * 100}%`}></div>
			</div>
		{/if}
	</div>
{/if}
