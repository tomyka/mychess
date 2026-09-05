<!-- mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte -->
<!--
	The coach chapter manager (GitHub issue #184).

	Reuses `ChapterSelectionList`, which is deliberately polarity-neutral: here
	a checked row means "selected for removal", and the heading, summary and
	primary button say so. Nothing destructive happens until the confirm panel,
	which states the real blast radius — aggregated over the whole selection,
	so a bulk removal reports one honest total rather than double-counting a
	line two removed chapters share.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import ChapterSelectionList, { type ChapterRow } from '$lib/components/ChapterSelectionList.svelte';
	import { m } from '$lib/paraglide/messages';

	type ChapterImpact = { name: string; lineCount: number; sharedLineCount: number; progressLineCount: number };

	// A local shape, not `PageData`, matching every other route in this
	// codebase that has a colocated component test (`reports`, `students`,
	// `players/[id]`, `practice/[id]/mastery`): `PageData` here is the merge of
	// this route's own load and every ancestor layout's — including the
	// `(coach)` group's `session`/`user`/`profile`/`isSignedOut` — which a
	// component test renders past, supplying only the fields this page reads.
	let {
		data
	}: {
		data: {
			repertoire: { id: string; name: string; color: string; moves_updated_at: string };
			assignedStudentCount: number;
			untaggedChapterName: string;
			chapters: ChapterImpact[];
		};
	} = $props();

	const repertoiresHref = '/coach/repertoires';

	let selectedIds = $state<Set<string>>(new Set());
	let confirming = $state(false);
	let removing = $state(false);
	let removeError = $state('');
	let removed = $state<{ count: number; lines: number } | null>(null);

	const selected = $derived(data.chapters.filter((chapter) => selectedIds.has(chapter.name)));
	const selectedNamesJson = $derived(JSON.stringify(selected.map((chapter) => chapter.name)));

	/**
	 * Aggregate cost of the current selection. `lineCount - sharedLineCount` is
	 * each chapter's exclusive lines — the ones that genuinely disappear. Summed
	 * over exclusive lines only, this cannot double-count: a line two selected
	 * chapters share is shared, so it is in neither chapter's exclusive count,
	 * and the server's own `removedVariationKeys` is the authority on the final
	 * number reported afterwards.
	 */
	const exclusiveLines = $derived(
		selected.reduce((sum, chapter) => sum + (chapter.lineCount - chapter.sharedLineCount), 0)
	);
	const sharedLines = $derived(selected.reduce((sum, chapter) => sum + chapter.sharedLineCount, 0));
	const progressLines = $derived(selected.reduce((sum, chapter) => sum + chapter.progressLineCount, 0));

	// Every chapter selected would empty the repertoire — that is a repertoire
	// delete, not a chapter removal. The action refuses it too; this only keeps
	// the coach from reaching a dead end.
	const removesEverything = $derived(
		data.chapters.length > 0 && selected.length === data.chapters.length
	);

	const rows = $derived<ChapterRow[]>(
		data.chapters.map((chapter) => {
			const untagged = chapter.name === data.untaggedChapterName;
			return {
				id: chapter.name,
				title: chapter.name,
				metaLine:
					chapter.sharedLineCount > 0
						? m.coach_chapters_meta_shared({ lines: chapter.lineCount, shared: chapter.sharedLineCount })
						: m.coach_chapters_meta({ lines: chapter.lineCount }),
				hint: untagged ? m.coach_chapters_untagged_hint() : undefined,
				// The untagged bucket is a UI tier, not a chapter — removing it
				// would empty the repertoire's un-chaptered remainder with no way
				// to name what came back.
				selectable: !untagged
			};
		})
	);
</script>

<svelte:head>
	<title>{m.seo_coach_chapters_title({ name: data.repertoire.name })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="mx-auto max-w-3xl px-4 py-6">
		{#if removed}
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-sm">
				<h1 class="text-xl font-bold text-(--color-text)">{m.coach_chapters_removed_heading()}</h1>
				<p class="mx-auto mt-2 max-w-prose text-sm text-(--color-muted)">
					{m.coach_chapters_removed_body({
						count: removed.count,
						lines: removed.lines,
						name: data.repertoire.name
					})}
				</p>
				<a
					href={repertoiresHref}
					class="mt-4 inline-block rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-(--color-accent-hover) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
				>
					{m.coach_chapters_back_link()}
				</a>
			</div>
		{:else}
			<h1 class="text-2xl font-bold text-(--color-text)">
				{m.coach_chapters_heading({ name: data.repertoire.name })}
			</h1>
			<p class="mt-1 max-w-prose text-sm text-(--color-muted)">
				{m.coach_chapters_intro({ count: data.assignedStudentCount })}
			</p>

			{#if removeError}
				<p class="mt-4 rounded-xl border border-(--color-diff-removed) px-4 py-2 text-sm text-(--color-diff-removed)">
					{removeError}
				</p>
			{/if}

			{#if data.chapters.length === 0}
				<p class="mt-4 max-w-prose rounded-xl border border-(--color-border) bg-(--color-surface) p-5 text-sm text-(--color-muted) shadow-sm">
					{m.coach_chapters_none()}
				</p>
			{:else}
				<div class="mt-4 space-y-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-sm">
					<ChapterSelectionList
						{rows}
						{selectedIds}
						onselect={(next) => (selectedIds = next)}
						summary={m.coach_chapters_summary({ total: data.chapters.length, selected: selected.length })}
					/>

					{#if confirming}
						<div class="space-y-2 rounded-xl border border-(--color-diff-removed) p-4">
							<h2 class="font-bold text-(--color-text)">
								{m.coach_chapters_confirm_heading({ count: selected.length })}
							</h2>
							<p class="text-sm text-(--color-muted)">
								{m.coach_chapters_confirm_lines({ lines: exclusiveLines, students: data.assignedStudentCount })}
							</p>
							{#if progressLines > 0}
								<p class="text-sm text-(--color-muted)">
									{m.coach_chapters_confirm_progress({ lines: progressLines })}
								</p>
							{/if}
							{#if sharedLines > 0}
								<p class="text-sm text-(--color-muted)">
									{m.coach_chapters_confirm_shared({ lines: sharedLines })}
								</p>
							{/if}

							<form
								method="POST"
								action="?/remove"
								use:enhance={() => {
									// Disabled from this moment until the response lands: two
									// removals sharing one `movesUpdatedAt` can each be
									// computed against a shape the other has already changed.
									removing = true;
									removeError = '';
									return async ({ result }) => {
										if (result.type === 'success') {
											const payload = result.data as { removed?: number; removedLineCount?: number } | undefined;
											removed = { count: payload?.removed ?? selected.length, lines: payload?.removedLineCount ?? 0 };
											return;
										}
										removing = false;
										confirming = false;
										if (result.type === 'failure') {
											// Shown verbatim: the 409 tells the coach to reload,
											// and rewording it would lose the instruction.
											removeError = String(
												(result.data as { error?: string } | undefined)?.error ?? m.coach_chapters_error_fallback()
											);
										} else if (result.type === 'error') {
											removeError = result.error?.message ?? m.coach_chapters_error_fallback();
										}
									};
								}}
								class="flex items-center justify-end gap-3 pt-2"
							>
								<input type="hidden" name="chapters" value={selectedNamesJson} />
								<!-- The shape these counts were computed against; the server
								     refuses the removal if the repertoire has moved since. -->
								<input type="hidden" name="movesUpdatedAt" value={data.repertoire.moves_updated_at} />
								<button
									type="button"
									onclick={() => (confirming = false)}
									disabled={removing}
									class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--color-text) disabled:opacity-60"
								>
									{m.coach_chapters_confirm_cancel()}
								</button>
								<button
									type="submit"
									disabled={removing}
									class="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{m.coach_chapters_confirm_remove()}
								</button>
							</form>
						</div>
					{:else}
						<div class="flex items-center justify-end gap-3">
							<a
								href={repertoiresHref}
								class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--color-text)"
							>
								{m.coach_chapters_back_link()}
							</a>
							<button
								type="button"
								onclick={() => (confirming = true)}
								disabled={selected.length === 0 || removesEverything}
								class="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{m.coach_chapters_remove_button({ count: selected.length })}
							</button>
						</div>
						{#if removesEverything}
							<p class="text-right text-sm text-(--color-diff-removed)">
								{m.coach_chapters_removes_everything()}
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</main>
