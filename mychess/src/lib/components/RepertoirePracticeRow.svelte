<!-- mychess/src/lib/components/RepertoirePracticeRow.svelte -->
<script lang="ts">
	import { VariationSelection, isIncludedFor } from '$lib/mastery/variationSelection.svelte';
	import { checkboxState } from './checkboxState';
	import RepertoireVariationTree from './RepertoireVariationTree.svelte';
	import { m } from '$lib/paraglide/messages';

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
		// Server-computed via the cheap chapter_count comparison (GitHub issue
		// #105) — only consulted for the mastered/not-mastered split once the
		// live counts below already agree everything is solved (see
		// `statusLabel`), since it can't react to a checkbox toggle the way
		// `liveAllSolved` does.
		status: 'learning' | 'learned' | 'mastered';
	};

	/**
	 * Where the row's title links. Passed in rather than hardcoded: this row is
	 * used by both the Learn list and the Practice list, and hardcoding one of
	 * them sent the other surface's visitors to the wrong mode (which is exactly
	 * what happened when the teaching flow moved to /learn in #96).
	 */
	let { rep, mode = 'learn' }: { rep: RepSummary; mode?: 'learn' | 'practice' } = $props();
	const href = $derived(`/${mode}/${rep.id}`);

	// The lazily-fetched variation rows plus every toggle that mutates them,
	// shared with the expanded tree below — the summary row here needs the same
	// rows for its live counts and its repertoire-level checkbox.
	const selection = new VariationSelection(() => rep.id);

	let expanded = $state(false);

	// null: the repertoire-level "everything" scope — truly included means any
	// chapter this line belongs to still includes it (GitHub issue #86).
	const checkedCount = $derived(
		selection.variations
			? selection.variations.filter((v) => isIncludedFor(v, null)).length
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
		selection.variations
			? selection.variations.filter((v) => isIncludedFor(v, null) && v.solved).length
			: rep.solved
	);
	const liveAllSolved = $derived(liveTotal > 0 && liveSolved === liveTotal);

	// Learning vs Learned is exact from the counts this row already has, so it
	// updates live as checkboxes toggle. Mastered rides on top of that: it only
	// ever shows once the live counts already agree everything is solved, and
	// otherwise trusts the server's cached chapter-mastery comparison (#105) —
	// a toggle can't earn or revoke a mastery run, so there's nothing live to
	// compute there.
	const statusLabel = $derived(
		!liveAllSolved
			? m.repertoire_row_status_learning()
			: rep.status === 'mastered'
				? m.repertoire_row_status_mastered()
				: m.repertoire_row_status_learned()
	);
	const isMastered = $derived(liveAllSolved && rep.status === 'mastered');
	const statusChipClass = $derived(
		isMastered
			? 'border-[#E8B923]/40 bg-[#E8B923]/10 text-[#a4790f] dark:text-[#E8B923]'
			: liveAllSolved
				? 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]'
				: 'border-(--color-border) bg-(--color-bg) text-(--color-muted)'
	);

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
		return selection.toggleGroup('__all__', () => true, null);
	}
</script>

<li class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm">
	<div class="flex items-center gap-3 p-4">
		{#if rep.fullVariationCount > 0}
			<label class="flex items-center shrink-0">
				<input type="checkbox" use:checkboxState={parentState} onchange={toggleParent} aria-label={m.repertoire_row_include_aria({ name: rep.name })} />
			</label>
			<button
				type="button"
				onclick={toggleExpanded}
				aria-label={expanded ? m.repertoire_row_collapse_aria({ name: rep.name }) : m.repertoire_row_expand_aria({ name: rep.name })}
				class="text-(--color-muted) shrink-0 w-4"
			>
				{expanded ? '▾' : '▸'}
			</button>
		{/if}
		<a {href} class="flex items-center gap-3 flex-1 min-w-0">
			<span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"
			></span>
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 min-w-0">
					<h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
					{#if liveTotal > 0}
						<span
							class="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border {statusChipClass}"
						>
							{statusLabel}
						</span>
					{/if}
				</div>
				<p class="text-sm text-(--color-muted)">
					{#if liveTotal === 0}
						{m.repertoire_row_no_moves()}
					{:else}
						{m.repertoire_row_progress({ solved: liveSolved, total: liveTotal })}
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
