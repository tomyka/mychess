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
			errorMessage = "Couldn't load variations — try again.";
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
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : 'Other';
	}

	const activeChapter = $derived(chapters === null ? null : openChapter);
	const currentGroups = $derived(activeChapter !== null || chapters === null ? moveGroups(activeChapter) : []);
	const openGroup = $derived(openGroupIndex !== null ? currentGroups[openGroupIndex] ?? null : null);
</script>

<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
	<div class="bg-(--color-surface) rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="font-bold text-(--color-text)">Choose a variation</h2>
			<button aria-label="Close" onclick={onclose} class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400">✕</button>
		</div>

		{#if variations === null}
			{#if errorMessage}
				<p class="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
			{:else}
				<p class="text-sm text-(--color-muted)">Loading…</p>
			{/if}
		{:else if openGroup}
			<button onclick={() => (openGroupIndex = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">← Back</button>
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
				<button onclick={() => (openChapter = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">← Back</button>
			{/if}
			<ul class="space-y-1">
				{#each currentGroups as group, i (group.steps.map((s) => s.san).join('>') || `other-${i}`)}
					<li>
						<button
							onclick={() => (openGroupIndex = i)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-(--color-text)"
						>
							{groupLabel(group)} <span class="text-(--color-muted) text-sm">({group.items.length})</span>
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
