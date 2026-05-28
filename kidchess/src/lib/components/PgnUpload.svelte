<script lang="ts">
	import { parsePgn } from '$lib/pgn/parser';
	import type { ParsedGame } from '$lib/pgn/parser';

	type Props = {
		onparsed?: (games: ParsedGame[]) => void;
	};

	let { onparsed }: Props = $props();

	let dragging = $state(false);
	let error = $state('');
	let gameCount = $state(0);

	function handleFile(file: File) {
		if (!file.name.endsWith('.pgn')) {
			error = 'Please select a .pgn file';
			return;
		}
		const reader = new FileReader();
		reader.onload = (e) => {
			try {
				const text = e.target!.result as string;
				const games = parsePgn(text);
				if (games.length === 0) {
					error = 'No valid games found in this PGN file';
					return;
				}
				gameCount = games.length;
				error = '';
				onparsed?.(games);
			} catch {
				error = 'Failed to parse PGN file';
			}
		};
		reader.readAsText(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files[0];
		if (file) handleFile(file);
	}

	function onFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) handleFile(file);
	}
</script>

<div
	class="border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer
		{dragging ? 'border-yellow-400 bg-yellow-400/10' : 'border-slate-600 hover:border-slate-400'}"
	ondragover={(e) => { e.preventDefault(); dragging = true; }}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
	onclick={() => document.getElementById('pgn-input')?.click()}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && document.getElementById('pgn-input')?.click()}
>
	<input id="pgn-input" type="file" accept=".pgn" class="hidden" onchange={onFileInput} />

	{#if gameCount > 0}
		<p class="text-4xl mb-2">✅</p>
		<p class="text-green-400 font-bold">{gameCount} game{gameCount !== 1 ? 's' : ''} loaded!</p>
		<p class="text-slate-400 text-sm mt-1">Click to replace with another file</p>
	{:else}
		<p class="text-4xl mb-2">📂</p>
		<p class="text-white font-semibold">Drop your PGN file here</p>
		<p class="text-slate-400 text-sm mt-1">or click to browse</p>
	{/if}

	{#if error}
		<p class="text-red-400 text-sm mt-3">{error}</p>
	{/if}
</div>
