<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import { groupByBranchPoint, moveSequenceLabel, type MoveGroup, type VariationStep } from '$lib/mastery/variations';

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
	// Move-group buckets drilled into so far, within the current chapter (or
	// the whole repertoire, when there's no chapter tier) — "Back" pops the
	// last entry. Unlike a fixed single-ply grouping, a bucket can represent
	// several plies at once (a forced run collapsed into one label), so
	// there's no fixed number of tiers to model as separate state variables;
	// a stack handles however deep any given line actually branches.
	let groupStack = $state<MoveGroup<VariationRow>[]>([]);
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

	const activeChapter = $derived(chapters === null ? null : openChapter);

	// The move-group buckets to show right now: the top of `groupStack` if
	// we've drilled in at least once, otherwise a fresh grouping of the
	// active chapter's (or the whole repertoire's) own variations.
	const currentGroups = $derived.by<MoveGroup<VariationRow>[]>(() => {
		if (activeChapter === null && chapters !== null) return []; // still at the chapter-list tier
		const top = groupStack[groupStack.length - 1];
		return top
			? groupByBranchPoint(top.items, stepsOf, top.depth, TOP_N)
			: groupByBranchPoint(rowsForChapter(activeChapter), stepsOf, 0, TOP_N);
	});

	function openChapterTier(chapterName: string) {
		openChapter = chapterName;
		groupStack = [];
	}

	function drillInto(group: MoveGroup<VariationRow>) {
		groupStack = [...groupStack, group];
	}

	function goBack() {
		if (groupStack.length > 0) {
			groupStack = groupStack.slice(0, -1);
		} else {
			openChapter = null;
		}
	}
</script>

<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
	<div class="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="font-bold text-gray-900">Choose a variation</h2>
			<button aria-label="Close" onclick={onclose} class="text-gray-400 hover:text-gray-600">✕</button>
		</div>

		{#if variations === null}
			{#if errorMessage}
				<p class="text-sm text-red-600">{errorMessage}</p>
			{:else}
				<p class="text-sm text-gray-400">Loading…</p>
			{/if}
		{:else if activeChapter !== null || chapters === null}
			{#if activeChapter !== null || groupStack.length > 0}
				<button onclick={goBack} class="text-indigo-600 text-sm mb-2 hover:underline">← Back</button>
			{/if}
			<ul class="space-y-1">
				{#each currentGroups as group, i (group.items.length === 1 ? group.items[0].variationKey : `${group.depth}-${group.steps.map((s) => s.san).join(' ')}-${i}`)}
					<li>
						{#if group.items.length === 1}
							<button
								onclick={() => onselect(group.items[0].variationKey)}
								class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700 flex items-center justify-between"
							>
								<span>{group.items[0].label}</span>
								{#if group.items[0].solved}<span class="text-green-600 text-sm">✓</span>{/if}
							</button>
						{:else}
							<button
								onclick={() => drillInto(group)}
								class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-gray-800"
							>
								{group.steps.length > 0 ? moveSequenceLabel(group.steps) : 'Other'}
								<span class="text-gray-400 text-sm">({group.items.length})</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="space-y-1">
				{#each chapters ?? [] as chapterName (chapterName)}
					<li>
						<button
							onclick={() => openChapterTier(chapterName)}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 font-medium text-gray-800"
						>
							{chapterName}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
