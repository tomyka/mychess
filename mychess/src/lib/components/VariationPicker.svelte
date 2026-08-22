<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import {
		groupByFirstMoves,
		moveSequenceLabel,
		chapterTiers,
		rowsInChapterTier,
		FIRST_MOVES_GROUP_PLIES,
		type MoveGroup,
		type VariationStep
	} from '$lib/mastery/variations';
	import { m } from '$lib/paraglide/messages';

	type VariationRow = {
		variationKey: string;
		label: string;
		included: boolean;
		// Every chapter this line belongs to — a line cross-referenced by two
		// chapters shows under both. Empty means untagged (see UNTAGGED_CHAPTER).
		chapterNames: string[];
		path: VariationStep[];
		solved: boolean;
	};

	let { repertoireId, onselect, onclose }: { repertoireId: string; onselect: (variationKey: string) => void; onclose: () => void } =
		$props();

	const TOP_N = 5;

	let variations = $state<VariationRow[] | null>(null);
	let openChapter = $state<string | null>(null);
	// Index into the currently-shown move-group list, not the group's own
	// identity — an index cleanly distinguishes "nothing opened yet" (`null`)
	// from "the Other bucket is opened" (an empty-steps group, but a real
	// index), which two otherwise-equal values couldn't.
	let openGroupIndex = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);

	function stepsOf(row: VariationRow): VariationStep[] {
		return row.path;
	}

	async function load() {
		try {
			const res = await fetch(`/api/repertoires/${repertoireId}/variations`);
			if (!res.ok) throw new Error('load failed');
			variations = await res.json();
			errorMessage = null;
		} catch {
			errorMessage = m.variation_picker_load_error();
		}
	}
	load();

	function includedRows(): VariationRow[] {
		return (variations ?? []).filter((r) => r.included);
	}

	// Chapters in first-appearance order, with the untagged bucket last; null
	// when no row is chaptered at all, which skips the chapter tier entirely in
	// the template below rather than making each ungrouped row its own group.
	const chapters = $derived.by(() => chapterTiers(includedRows()));

	// `null` is the flat, chapterless pool (only reachable when `chapters` is
	// null) — distinct from the untagged bucket WITHIN a chaptered repertoire,
	// which is a real tier name like any other.
	function rowsForChapter(chapter: string | null): VariationRow[] {
		const rows = includedRows();
		return chapter === null ? rows : rowsInChapterTier(rows, chapter);
	}

	function moveGroups(chapter: string | null): MoveGroup<VariationRow>[] {
		return groupByFirstMoves(rowsForChapter(chapter), stepsOf, FIRST_MOVES_GROUP_PLIES, TOP_N);
	}

	function groupLabel(group: MoveGroup<VariationRow>): string {
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : m.variation_picker_other_group_label();
	}

	/**
	 * The single variation a move-group holds, or null if it holds several.
	 *
	 * A group's button is labelled with its shared opening moves, so a group of
	 * one reads as a variation already — drilling into it just showed a list of
	 * one row with a near-identical label (identical, for any line no longer
	 * than the grouping window). Groups of one are therefore selected directly
	 * instead, skipping a tier that carried no new information.
	 */
	function soleVariation(group: MoveGroup<VariationRow>): VariationRow | null {
		return group.items.length === 1 ? group.items[0] : null;
	}

	const activeChapter = $derived(chapters === null ? null : openChapter);
	const currentGroups = $derived(activeChapter !== null || chapters === null ? moveGroups(activeChapter) : []);
	const openGroup = $derived(openGroupIndex !== null ? currentGroups[openGroupIndex] ?? null : null);
</script>

<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
	<div class="bg-(--color-surface) rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="font-bold text-(--color-text)">{m.variation_picker_heading()}</h2>
			<button aria-label={m.picker_close_aria()} onclick={onclose} class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400">✕</button>
		</div>

		{#if variations === null}
			{#if errorMessage}
				<p class="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
			{:else}
				<p class="text-sm text-(--color-muted)">{m.variation_picker_loading()}</p>
			{/if}
		{:else if openGroup}
			<button onclick={() => (openGroupIndex = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
			<ul class="space-y-1">
				{#each openGroup.items as row (row.variationKey)}
					<li>
						<button
							onclick={() => onselect(row.variationKey)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between"
						>
							<span>{row.label}</span>
							{#if row.solved}<span class="text-green-600 dark:text-green-400 text-sm">✓</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else if activeChapter !== null || chapters === null}
			{#if chapters !== null}
				<button onclick={() => (openChapter = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
			{/if}
			<ul class="space-y-1">
				{#each currentGroups as group, i (group.steps.map((s) => s.san).join('>') || `other-${i}`)}
					{@const only = soleVariation(group)}
					<li>
						<!-- A group of one IS a variation, so it selects straight into
						     practice and renders like a variation row (own full label,
						     solved tick, no count) rather than as a folder holding one
						     item. Groups of several still drill in. -->
						<button
							onclick={() => (only ? onselect(only.variationKey) : (openGroupIndex = i))}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between {only
								? ''
								: 'font-medium'}"
						>
							<span>{only ? only.label : groupLabel(group)}</span>
							{#if only}
								{#if only.solved}<span class="text-green-600 dark:text-green-400 text-sm">✓</span>{/if}
							{:else}
								<span class="text-(--color-muted) text-sm">({group.items.length})</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="space-y-1">
				{#each chapters ?? [] as chapter (chapter)}
					<li>
						<button
							onclick={() => (openChapter = chapter)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-(--color-text)"
						>
							{chapter}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
