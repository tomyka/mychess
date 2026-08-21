<!-- mychess/src/lib/components/EngineEval.svelte -->
<!--
	The engine's toggle and its numeric readout. The bar that used to sit under
	this (a thin horizontal W|B strip inside the card) is gone: an evaluation
	belongs next to the position it describes, so it now lives on the board's own
	edge as EvalBar.svelte. Both components read the same shared worker via
	$lib/engine/engine.svelte.ts.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enginePrefStore, setEnginePref } from '$lib/enginePref.svelte';
	import { engineState, ensureEngine, teardownEngine, requestIfDue, retainEngine } from '$lib/engine/engine.svelte';
	import { formatEval } from '$lib/engine/uci';

	let { fen }: { fen: string } = $props();

	onDestroy(retainEngine());

	// Spawns the engine as soon as the preference is on (including at mount, if
	// it was already enabled from a prior session) and tears it down the moment
	// it's switched off — not just on unmount.
	$effect(() => {
		if (enginePrefStore.enabled) ensureEngine();
		else teardownEngine();
	});

	// Fires once at mount time once `ready` flips true (re-evaluating the fen
	// already present at that point), and again on every later fen change — a
	// single code path for both cases. The shared lastRequestedFen means
	// whichever consumer's effect runs first for a given fen requests it; the
	// others are then a same-fen no-op.
	$effect(() => {
		requestIfDue(fen);
	});

	const displayText = $derived(engineState.score ? formatEval(engineState.score) : '…');
</script>

<div class="flex items-center gap-2">
	<span class="text-xs font-semibold uppercase tracking-wide text-(--color-muted)">Engine</span>
	<button
		type="button"
		role="switch"
		aria-checked={enginePrefStore.enabled}
		aria-label="Toggle engine evaluation"
		onclick={() => setEnginePref(!enginePrefStore.enabled)}
		class="relative w-9 h-5 rounded-full shrink-0 transition-colors {enginePrefStore.enabled
			? 'bg-(--color-accent)'
			: 'bg-(--color-border)'}"
	>
		<span
			class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm flex items-center justify-center transition-transform {enginePrefStore.enabled
				? 'translate-x-4'
				: ''}"
		>
			{#if enginePrefStore.enabled}
				<svg viewBox="0 0 20 20" fill="currentColor" class="w-2.5 h-2.5 text-(--color-accent)" aria-hidden="true">
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
		{#if engineState.failed}
			<span class="text-sm text-(--color-muted) italic">unavailable</span>
		{:else}
			<span class="text-base font-bold text-(--color-text) tabular-nums shrink-0">{displayText}</span>
		{/if}
	{/if}
</div>
