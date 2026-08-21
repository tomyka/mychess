<!-- mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.svelte -->
<!--
	Re-upload a revised PGN over an existing repertoire (GitHub issue #118).

	Three steps, one page: pick a file → `?/preview` (which writes nothing, so the
	coach can read the cost and walk away) → `?/apply`. The PGN is parsed HERE,
	client-side, by the same `planMultiImport` the first-time import uses, so the
	server receives `[{ name, moves }]` rather than raw PGN text.

	This route owns both forms; `RepertoireDiffReview` owns the coach's decisions
	and hands them back through `ondecisions`.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { planMultiImport, type MoveRow } from '$lib/pgn-import';
	import RepertoireDiffReview, {
		type ReviewDecisions,
		type ReviewPreview
	} from '$lib/components/RepertoireDiffReview.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const repertoiresHref = '/coach/repertoires';

	let fileName = $state('');
	let fileError = $state('');
	/** The upload, in the shape both actions validate: one entry per chapter. */
	let chapters = $state<Array<{ name: string | null; moves: MoveRow[] }>>([]);

	let previewing = $state(false);
	let previewError = $state('');
	let preview = $state<ReviewPreview | null>(null);

	let applying = $state(false);
	let applyError = $state('');
	let applied = $state(false);

	let decisions = $state<ReviewDecisions>({ acceptedRenames: [], canApply: false });

	const chaptersJson = $derived(JSON.stringify(chapters));
	const renamesJson = $derived(JSON.stringify(decisions.acceptedRenames));

	function onFileChange(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		fileName = file.name;
		fileError = '';
		// A new file invalidates the preview it was not computed from — leaving the
		// old one on screen beside a new file name is how a coach applies a diff
		// they never read.
		preview = null;
		previewError = '';
		chapters = [];

		const reader = new FileReader();
		reader.onload = () => {
			const plan = planMultiImport(String(reader.result), (data.repertoire.color as 'white' | 'black') ?? 'white');
			if ('error' in plan) {
				fileError = plan.error;
				return;
			}
			// `name: null` for a single-game PGN, matching what the first-time
			// import sends: a one-chapter upload has nothing to group, and a
			// synthetic chapter name here would read as a brand-new chapter in the
			// diff.
			const multi = plan.length > 1;
			chapters = plan.map((chapter) => ({ name: multi ? chapter.name : null, moves: chapter.moves }));
		};
		reader.onerror = () => {
			fileError = 'Could not read that file — try exporting the study again.';
		};
		reader.readAsText(file);
	}
</script>

<svelte:head>
	<title>Update {data.repertoire.name} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="mx-auto max-w-6xl px-4 py-6">
		{#if applied}
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-sm">
				<h1 class="text-xl font-bold text-(--color-text)">Update applied</h1>
				<p class="mx-auto mt-2 max-w-prose text-sm text-(--color-muted)">
					“{data.repertoire.name}” now matches {fileName}. Each student's progress will be carried forward on
					their next visit, and they will see what changed.
				</p>
				<a
					href={repertoiresHref}
					class="mt-4 inline-block rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-(--color-accent-hover) focus:bg-(--color-accent-hover) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
				>
					Back to repertoires
				</a>
			</div>
		{:else if preview}
			{#if applyError}
				<p
					class="mb-4 rounded-xl border border-(--color-diff-removed) px-4 py-2 text-sm text-(--color-diff-removed)"
				>
					{applyError}
				</p>
			{/if}
			<form
				method="POST"
				action="?/apply"
				use:enhance={() => {
					// Disabled from this moment until the response lands. Two applies
					// sharing one `movesUpdatedAt` can each retire the other's new
					// lines, and the server's staleness check does not close that
					// window — so the UI must not open it.
					applying = true;
					applyError = '';
					return async ({ result }) => {
						if (result.type === 'success') {
							applied = true;
							return;
						}
						applying = false;
						if (result.type === 'failure') {
							// Shown verbatim: the 409 tells the coach to reload, and
							// rewording it would lose the instruction.
							applyError = String((result.data as { error?: string } | undefined)?.error ?? 'Could not apply the update.');
						} else if (result.type === 'error') {
							applyError = result.error?.message ?? 'Could not apply the update.';
						}
					};
				}}
			>
				<input type="hidden" name="chapters" value={chaptersJson} />
				<!-- The shape the diff on screen was computed against; the server
				     refuses the apply if the repertoire has moved since. -->
				<input type="hidden" name="movesUpdatedAt" value={preview.movesUpdatedAt} />
				<input type="hidden" name="renames" value={renamesJson} />
				<RepertoireDiffReview
					{preview}
					repertoireName={data.repertoire.name}
					{fileName}
					assignedStudentCount={preview.assignedStudentCount}
					submitting={applying}
					cancelHref={repertoiresHref}
					ondecisions={(next) => (decisions = next)}
				/>
			</form>
		{:else}
			<h1 class="text-2xl font-bold text-(--color-text)">Update “{data.repertoire.name}” from a file</h1>
			<p class="mt-1 max-w-prose text-sm text-(--color-muted)">
				Upload the revised study. Nothing is written until you have read the review and pressed Apply, and
				{data.assignedStudentCount}
				{data.assignedStudentCount === 1 ? 'student' : 'students'} assigned to this repertoire will keep the depth
				they have already earned.
			</p>

			<form
				method="POST"
				action="?/preview"
				use:enhance={() => {
					previewing = true;
					previewError = '';
					return async ({ result }) => {
						previewing = false;
						if (result.type === 'success') {
							preview = result.data as unknown as ReviewPreview;
						} else if (result.type === 'failure') {
							previewError = String(
								(result.data as { error?: string } | undefined)?.error ?? 'Could not read that file.'
							);
						} else if (result.type === 'error') {
							previewError = result.error?.message ?? 'Could not read that file.';
						}
					};
				}}
				class="mt-4 space-y-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-sm"
			>
				<div>
					<label class="mb-1 block text-sm font-medium text-(--color-text)" for="pgn_file">
						Revised .pgn file
					</label>
					<div class="flex items-center gap-3">
						<label
							for="pgn_file"
							class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--color-border) px-4 py-2.5 text-sm font-medium text-(--color-text) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) focus-within:border-(--color-accent) focus-within:text-(--color-accent)"
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="shrink-0"
								aria-hidden="true"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="17 8 12 3 7 8" />
								<line x1="12" y1="3" x2="12" y2="15" />
							</svg>
							Choose File
						</label>
						<input
							id="pgn_file"
							type="file"
							accept=".pgn"
							onchange={onFileChange}
							disabled={previewing}
							class="hidden"
						/>
						{#if fileName}
							<span class="min-w-0 truncate text-sm text-(--color-muted)">{fileName}</span>
						{/if}
					</div>
					{#if fileError}
						<p class="mt-1 text-sm text-(--color-diff-removed)">{fileError}</p>
					{/if}
				</div>

				{#if chapters.length > 0}
					<p class="text-sm text-(--color-muted)">
						<span class="tabular-nums font-semibold text-(--color-text)">{chapters.length}</span>
						{chapters.length === 1 ? 'chapter' : 'chapters'} read from this file.
					</p>
				{/if}

				{#if previewError}
					<p
						class="rounded-xl border border-(--color-diff-removed) px-4 py-2 text-sm text-(--color-diff-removed)"
					>
						{previewError}
					</p>
				{/if}

				<input type="hidden" name="chapters" value={chaptersJson} />
				<div class="flex items-center justify-end gap-3">
					<a
						href={repertoiresHref}
						class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:border-(--color-accent) hover:text-(--color-text) focus:border-(--color-accent) focus:text-(--color-text) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
					>
						Cancel
					</a>
					<button
						type="submit"
						disabled={previewing || chapters.length === 0}
						class="rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-(--color-accent-hover) focus:bg-(--color-accent-hover) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent) disabled:cursor-not-allowed disabled:opacity-60"
					>
						{previewing ? 'Reading…' : 'Review changes'}
					</button>
				</div>
			</form>
		{/if}
	</div>
</main>
