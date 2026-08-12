<!-- mychess/src/lib/components/PgnImportForm.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { planMultiImport } from '$lib/pgn-import';

	type Props = {
		submitLabel: string;
		redirectTo: string;
	};
	let { submitLabel, redirectTo }: Props = $props();

	let name = $state('');
	let color = $state<'white' | 'black'>('white');
	let pgnText = $state('');
	let fileError = $state('');
	let fileName = $state('');
	let errorMessage = $state('');

	type ChapterStatus = 'pending' | 'importing' | 'done' | 'error';
	let chapters = $state<{ name: string; status: ChapterStatus }[]>([]);
	let importing = $state(false);
	let doneCount = $derived(chapters.filter((c) => c.status === 'done').length);

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		fileName = file.name;
		name = file.name.replace(/\.[^/.]+$/, '');
		const reader = new FileReader();
		reader.onload = () => {
			pgnText = reader.result as string;
			fileError = '';
		};
		reader.onerror = () => {
			fileError = 'Could not read that file — try pasting the PGN text instead.';
		};
		reader.readAsText(file);
	}

	/**
	 * Imports one chapter per request instead of one request doing every
	 * chapter before replying — the whole point being a real, per-chapter
	 * progress bar instead of the page just sitting there for a large
	 * multi-chapter PGN. Every chapter after the first passes
	 * `existingRepertoireId` so they all land in the SAME repertoire (see
	 * `writeMoves`) instead of each becoming its own. Every chapter EXCEPT
	 * THE LAST also passes `finalize: false`: `writeMoves` can only compute a
	 * correct shape (total_variations/total_levels/level1_task_count) once
	 * every chapter's moves are in, so only the last chapter lets it default
	 * to true, at which point it fetches the repertoire's complete move set
	 * and computes the real shape from that.
	 *
	 * On failure, rolls back the one shared repertoire created so far (if
	 * any) — a multi-chapter import is all-or-nothing, matching the old
	 * single-request behavior's guarantee.
	 */
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';

		const trimmedName = name.trim();
		const trimmedPgn = pgnText.trim();
		if (!trimmedName || !trimmedPgn) {
			errorMessage = 'Name and PGN are required';
			return;
		}

		const plan = planMultiImport(trimmedPgn, color);
		if ('error' in plan) {
			errorMessage = plan.error;
			return;
		}

		importing = true;
		const isMultiChapter = plan.length > 1;
		chapters = plan.map((chapter) => ({
			name: isMultiChapter ? `${trimmedName} — ${chapter.name}` : trimmedName,
			status: 'pending' as ChapterStatus
		}));

		let sharedRepertoireId: string | null = null;
		for (let i = 0; i < plan.length; i++) {
			const isLastChapter = i === plan.length - 1;
			chapters[i].status = 'importing';
			try {
				const res: Response = await fetch('/api/repertoires/import-chapter', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: chapters[i].name,
						color,
						ecoCode: plan[i].ecoCode,
						ecoName: plan[i].ecoName,
						moves: plan[i].moves,
						...(sharedRepertoireId ? { existingRepertoireId: sharedRepertoireId } : {}),
						...(isMultiChapter && !isLastChapter ? { finalize: false } : {})
					})
				});
				if (!res.ok) {
					const body = await res.json().catch(() => null);
					throw new Error(body?.message ?? 'Import failed');
				}
				const { repertoireId } = await res.json();
				sharedRepertoireId = repertoireId;
				chapters[i].status = 'done';
			} catch (err) {
				chapters[i].status = 'error';
				errorMessage = err instanceof Error ? err.message : 'Import failed';
				if (sharedRepertoireId) await fetch(`/api/repertoires/${sharedRepertoireId}`, { method: 'DELETE' });
				importing = false;
				return;
			}
		}

		await goto(redirectTo);
	}
</script>

{#if errorMessage}
	<p class="text-red-600 mb-4 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{errorMessage}</p>
{/if}

<form onsubmit={handleSubmit} class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
	<div>
		<label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
		<input id="name" name="name" required placeholder="e.g. Sicilian Defense" bind:value={name} disabled={importing}
		       class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
	</div>

	<div>
		<span class="block text-sm font-medium text-gray-700 mb-1">Color</span>
		<div class="flex gap-3">
			{#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as c (c.id)}
				<button
					type="button"
					disabled={importing}
					onclick={() => (color = c.id)}
					class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm disabled:opacity-60
					       {color === c.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
				>
					{c.label}
				</button>
			{/each}
		</div>
	</div>

	<div>
		<label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_text">Paste PGN text</label>
		<textarea id="pgn_text" name="pgn_text" rows="8" bind:value={pgnText} disabled={importing}
		           placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
		           class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none disabled:opacity-60"
		></textarea>
	</div>

	<div>
		<label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_file">…or upload a .pgn file</label>
		<div class="flex items-center gap-3">
			<label for="pgn_file"
			       class="cursor-pointer inline-block bg-gray-100 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 transition-colors">
				Choose File
			</label>
			<input id="pgn_file" type="file" accept=".pgn" onchange={onFileChange} disabled={importing} class="hidden" />
			{#if fileName}
				<span class="text-sm text-gray-500 truncate">{fileName}</span>
			{/if}
		</div>
		{#if fileError}
			<p class="text-red-600 text-sm mt-1">{fileError}</p>
		{/if}
	</div>

	{#if chapters.length > 0}
		<div class="space-y-2">
			<div class="flex justify-between text-sm text-gray-500">
				<span>{importing ? 'Importing…' : 'Import finished'}</span>
				<span>{doneCount} / {chapters.length}</span>
			</div>
			<div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
				<div class="bg-indigo-600 h-2 transition-all duration-300"
				     style="width: {(doneCount / chapters.length) * 100}%"></div>
			</div>
			{#if chapters.length > 1}
				<ul class="text-sm space-y-1 max-h-40 overflow-y-auto">
					{#each chapters as chapter}
						<li class="flex items-center gap-2">
							<span class="w-4 text-center shrink-0">
								{#if chapter.status === 'done'}✓{:else if chapter.status === 'importing'}⚙{:else if chapter.status === 'error'}✗{:else}·{/if}
							</span>
							<span class="truncate {chapter.status === 'error' ? 'text-red-600' : 'text-gray-700'}">{chapter.name}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<button type="submit" disabled={importing}
	        class="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
		{importing ? 'Importing…' : submitLabel}
	</button>
</form>
