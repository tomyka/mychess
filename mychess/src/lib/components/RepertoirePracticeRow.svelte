<!-- mychess/src/lib/components/RepertoirePracticeRow.svelte -->
<script lang="ts">
	import { VariationSelection } from '$lib/mastery/variationSelection.svelte';
	import { checkboxState } from './checkboxState';
	import RepertoireVariationTree from './RepertoireVariationTree.svelte';

	type RepSummary = {
		id: string;
		name: string;
		color: string;
		solved: number;
		total: number;
		allSolved: boolean;
		fullVariationCount: number;
		excludedVariationCount: number;
		// Whether this repertoire has any chapter-tagged variation at all.
		// Mirrors the server-side RepertoireProgressSummary field, but this
		// component no longer gates on it — the expanded tree derives the same
		// fact live from the loaded variations, since a repertoire without
		// chapters is now just as selectable as one with them, only skipping
		// the chapter tier.
		hasChapters: boolean;
	};

	let { rep }: { rep: RepSummary } = $props();

	// The lazily-fetched variation rows plus every toggle that mutates them,
	// shared with the expanded tree below — the summary row here needs the same
	// rows for its live counts and its repertoire-level checkbox.
	const selection = new VariationSelection(() => rep.id);

	let expanded = $state(false);

	const checkedCount = $derived(
		selection.variations
			? selection.variations.filter((v) => v.included).length
			: rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(selection.variations ? selection.variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	// Solved/total for the subtitle — once the variations are loaded, this is
	// computed live from them (matching repertoire-progress.ts's own
	// exclusion-aware formula: total counts only currently-included
	// variations, solved counts only INCLUDED solved ones) so toggling a
	// checkbox updates the count immediately, instead of only catching up
	// once the server-provided `rep` prop is next refreshed (a full page
	// load). Falls back to the static `rep` summary before anything's been
	// fetched, since there's nothing live to compute from yet.
	const liveTotal = $derived(selection.variations ? checkedCount : rep.total);
	const liveSolved = $derived(
		selection.variations ? selection.variations.filter((v) => v.included && v.solved).length : rep.solved
	);
	const liveAllSolved = $derived(liveTotal > 0 && liveSolved === liveTotal);

	async function toggleExpanded() {
		expanded = !expanded;
		if (expanded) {
			try {
				await selection.ensureLoaded();
			} catch {
				// selection.errorMessage is already set inside ensureLoaded.
			}
		}
	}

	function toggleParent() {
		return selection.toggleGroup('__all__', () => true);
	}
</script>

<li class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm">
	<div class="flex items-center gap-3 p-4">
		{#if rep.fullVariationCount > 0}
			<label class="flex items-center shrink-0">
				<input type="checkbox" use:checkboxState={parentState} onchange={toggleParent} aria-label={`Include ${rep.name} in practice`} />
			</label>
			<button
				type="button"
				onclick={toggleExpanded}
				aria-label={expanded ? `Collapse ${rep.name}` : `Expand ${rep.name}`}
				class="text-(--color-muted) shrink-0 w-4"
			>
				{expanded ? '▾' : '▸'}
			</button>
		{/if}
		<a href="/practice/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
			<span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"
			></span>
			<div class="flex-1 min-w-0">
				<h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
				<p class="text-sm text-(--color-muted)">
					{#if liveTotal === 0}
						No moves yet
					{:else if liveAllSolved}
						🏆 Solved · {liveSolved}/{liveTotal}
					{:else}
						{liveSolved}/{liveTotal} variations solved
					{/if}
				</p>
			</div>
			<span class="text-(--color-muted) text-sm">→</span>
		</a>
	</div>

	{#if selection.errorMessage}
		<p class="px-4 pb-2 text-xs text-red-600 dark:text-red-400">{selection.errorMessage}</p>
	{/if}

	{#if expanded}
		<RepertoireVariationTree {selection} repName={rep.name} />
	{/if}
</li>
