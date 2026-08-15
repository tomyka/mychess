<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import { groupByFirstMoves, moveSequenceLabel, FIRST_MOVES_GROUP_PLIES, type MoveGroup, type VariationStep } from '$lib/mastery/variations';

	type VariationRow = {
		variationKey: string;
		label: string;
		included: boolean;
		chapterName: string | null;
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

	// Preserves first-appearance order; a null chapterName groups everything
	// into one implicit chapter (skips the chapter tier entirely in the
	// template below) rather than each ungrouped row becoming its own group.
	const chapters = $derived.by(() => {
		const rows = (variations ?? []).filter((r) => r.included);
		if (rows.every((r) => r.chapterName === null)) return null;
		const names: string[] = [];
		for (const r of rows) {
			const name = r.chapterName ?? '';
			if (!names.includes(name)) names.push(name);
		}
		return names;
	});

	function rowsForChapter(chapterName: string | null): VariationRow[] {
		const rows = (variations ?? []).filter((r) => r.included);
		return chapterName === null ? rows : rows.filter((r) => r.chapterName === chapterName);
	}

	function moveGroups(chapterName: string | null): MoveGroup<VariationRow>[] {
		return groupByFirstMoves(rowsForChapter(chapterName), stepsOf, FIRST_MOVES_GROUP_PLIES, TOP_N);
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
			<button aria-label="Close" onclick={onclose} class="text-(--color-muted) hover:text-gray-600">✕</button>
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
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-(--color-text) flex items-center justify-between"
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
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-(--color-text)"
						>
							{groupLabel(group)} <span class="text-(--color-muted) text-sm">({group.items.length})</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="space-y-1">
				{#each chapters ?? [] as chapterName (chapterName)}
					<li>
						<button
							onclick={() => (openChapter = chapterName)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-(--color-text)"
						>
							{chapterName}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
