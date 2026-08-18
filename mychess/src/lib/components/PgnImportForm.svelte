<!-- mychess/src/lib/components/PgnImportForm.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { planMultiImport } from '$lib/pgn-import';
	import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';

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
	let driveError = $state('');
	let drivePicking = $state(false);
	let errorMessage = $state('');

	type ChapterStatus = 'pending' | 'importing' | 'done' | 'error';
	let chapters = $state<{ name: string; status: ChapterStatus }[]>([]);
	let importing = $state(false);
	let doneCount = $derived(chapters.filter((c) => c.status === 'done').length);

	/**
	 * Theme-aware colour for a chapter's status glyph. These used to carry no
	 * colour class at all, so they inherited the default near-black body text —
	 * which made the ✓ on a completed chapter almost invisible against a dark
	 * surface. Semantic colours (green/red) keep their light class and add a
	 * one-step-lighter `dark:` variant, matching how the rest of the app handles
	 * success/error text; the neutral states use the muted token, which already
	 * has a dark override.
	 */
	function statusIconClass(status: ChapterStatus): string {
		if (status === 'done') return 'text-green-600 dark:text-green-400';
		if (status === 'error') return 'text-red-600 dark:text-red-400';
		// 'importing' and 'pending' are both transient/neutral — the spinner
		// glyph and the placeholder dot read as secondary information.
		return 'text-(--color-muted)';
	}

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		driveError = '';
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

	async function onGoogleDriveClick() {
		driveError = '';
		fileError = '';
		drivePicking = true;
		try {
			const result = await pickPgnFromGoogleDrive();
			if (result) {
				pgnText = result.text;
				name = result.name.replace(/\.[^/.]+$/, '');
				fileName = result.name;
			}
		} catch (err) {
			driveError = err instanceof Error ? err.message : 'Could not import from Google Drive.';
		} finally {
			drivePicking = false;
		}
	}

	/**
	 * Imports one chapter per request instead of one request doing every
	 * chapter before replying — the whole point being a real, per-chapter
	 * progress bar instead of the page just sitting there for a large
	 * multi-chapter PGN. Every chapter after the first passes
	 * `existingRepertoireId` so they all land in the SAME repertoire (see
	 * `writeMoves`) instead of each becoming its own. Every chapter EXCEPT
	 * THE LAST also passes `finalize: false`: `writeMoves` can only compute a
	 * correct `total_variations` count once every chapter's moves are in, so
	 * only the last chapter lets it default to true, at which point it
	 * fetches the repertoire's complete move set and computes the real count
	 * from that. Every chapter of a multi-chapter
	 * import also passes `chapterLabel` (the chapter's own bare PGN title) so
	 * the Practice picker can later group this chapter's variations together
	 * — omitted for a single-chapter import, which has nothing to group.
	 * `name` is always the repertoire name the user typed, for every chapter
	 * — only the first chapter's `name` is ever actually stored (see
	 * `writeMoves`; later chapters append to the repertoire it already
	 * created), but it's sent on every request for consistency. It used to
	 * be suffixed with the chapter's own title for a multi-chapter import
	 * ("My Study — Line A"), which is no longer needed now that the Practice
	 * picker shows each chapter's real title as its own group header instead.
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
			name: chapter.name,
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
						name: trimmedName,
						color,
						ecoCode: plan[i].ecoCode,
						ecoName: plan[i].ecoName,
						moves: plan[i].moves,
						...(sharedRepertoireId ? { existingRepertoireId: sharedRepertoireId } : {}),
						...(isMultiChapter && !isLastChapter ? { finalize: false } : {}),
						...(isMultiChapter ? { chapterLabel: plan[i].name } : {})
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
	<p class="text-red-600 mb-4 bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 dark:text-red-400 px-4 py-2 rounded-xl text-sm">{errorMessage}</p>
{/if}

<form onsubmit={handleSubmit} class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5 space-y-4">
	<div>
		<label class="block text-sm font-medium text-(--color-text) mb-1" for="name">Repertoire Name</label>
		<input id="name" name="name" required placeholder="e.g. Sicilian Defense" bind:value={name} disabled={importing || drivePicking}
		       class="w-full rounded-lg px-4 py-2.5 border border-(--color-border) text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
	</div>

	<div>
		<span class="block text-sm font-medium text-(--color-text) mb-1">Color</span>
		<div class="flex gap-3">
			{#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as c (c.id)}
				<button
					type="button"
					disabled={importing}
					onclick={() => (color = c.id)}
					class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm disabled:opacity-60
					       {color === c.id ? 'border-(--color-accent) bg-indigo-50 dark:bg-indigo-950 text-indigo-700' : 'border-(--color-border) text-(--color-muted) hover:border-gray-300 dark:hover:border-gray-600'}"
				>
					{c.label}
				</button>
			{/each}
		</div>
	</div>

	<div>
		<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_text">Paste PGN text</label>
		<textarea id="pgn_text" name="pgn_text" rows="8" bind:value={pgnText} disabled={importing || drivePicking}
		           placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
		           class="w-full rounded-lg px-4 py-2.5 border border-(--color-border) text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none disabled:opacity-60"
		></textarea>
	</div>

	<div>
		<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_file">…or upload a .pgn file</label>
		<div class="flex items-center gap-3">
			<label for="pgn_file"
			       class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="17 8 12 3 7 8" />
					<line x1="12" y1="3" x2="12" y2="15" />
				</svg>
				Choose File
			</label>
			<input id="pgn_file" type="file" accept=".pgn" onchange={onFileChange} disabled={importing || drivePicking} class="hidden" />
		</div>
		{#if fileError}
			<p class="text-red-600 dark:text-red-400 text-sm mt-1">{fileError}</p>
		{/if}
	</div>

	<div>
		<div class="flex items-center gap-3">
			<button type="button" onclick={onGoogleDriveClick} disabled={importing || drivePicking}
			        class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
				<svg width="16" height="16" viewBox="0 0 87.3 78" class="shrink-0" aria-hidden="true">
					<path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
					<path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
					<path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
					<path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
					<path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
					<path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
				</svg>
				{drivePicking ? 'Opening Google Drive…' : '…or import from Google Drive'}
			</button>
		</div>
		{#if driveError}
			<p class="text-red-600 dark:text-red-400 text-sm mt-1">{driveError}</p>
		{/if}
	</div>

	{#if fileName}
		<p class="text-sm text-(--color-muted) truncate">Selected: {fileName}</p>
	{/if}

	{#if chapters.length > 0}
		<div class="space-y-2">
			<div class="flex justify-between text-sm text-(--color-muted)">
				<span>{importing ? 'Importing…' : 'Import finished'}</span>
				<span>{doneCount} / {chapters.length}</span>
			</div>
			<div class="w-full bg-(--color-border) rounded-full h-2 overflow-hidden">
				<div class="bg-(--color-accent) h-2 transition-all duration-300"
				     style="width: {(doneCount / chapters.length) * 100}%"></div>
			</div>
			{#if chapters.length > 1}
				<ul class="text-sm space-y-1 max-h-40 overflow-y-auto">
					{#each chapters as chapter}
						<li class="flex items-center gap-2">
							<span class="w-4 text-center shrink-0 {statusIconClass(chapter.status)}">
								{#if chapter.status === 'done'}✓{:else if chapter.status === 'importing'}⚙{:else if chapter.status === 'error'}✗{:else}·{/if}
							</span>
							<span class="truncate {chapter.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-(--color-text)'}">{chapter.name}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<button type="submit" disabled={importing || drivePicking}
	        class="w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-base hover:bg-(--color-accent-hover) transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
		{importing ? 'Importing…' : submitLabel}
	</button>
</form>
