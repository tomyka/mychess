<!-- mychess/src/lib/components/RepertoirePracticeRow.svelte -->
<script lang="ts">
	import { levelTag } from '$lib/mastery/tags';

	type RepSummary = {
		id: string;
		name: string;
		color: string;
		level: number | 'mastered';
		totalLevels: number;
		levelTaskCount: number;
		levelSolvedCount: number;
		totalVariations: number;
		fullVariationCount: number;
		excludedVariationCount: number;
	};
	type VariationRow = { variationKey: string; label: string; included: boolean };

	let { rep }: { rep: RepSummary } = $props();

	let expanded = $state(false);
	let variations = $state<VariationRow[] | null>(null);
	let loadingVariations = $state(false);
	let errorMessage = $state<string | null>(null);
	// The set of variationKeys that were included right before the parent
	// checkbox last bulk-excluded everything — lets re-checking the parent
	// restore exactly that selection instead of blanket-including everything.
	let uncheckSnapshot = $state<Set<string> | null>(null);

	const checkedCount = $derived(
		variations ? variations.filter((v) => v.included).length : rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(variations ? variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(newValue: boolean) {
				node.indeterminate = newValue;
			}
		};
	}

	async function ensureVariationsLoaded(): Promise<VariationRow[]> {
		if (variations) return variations;
		loadingVariations = true;
		try {
			const res = await fetch(`/api/repertoires/${rep.id}/variations`);
			if (!res.ok) throw new Error('load failed');
			const data = (await res.json()) as VariationRow[];
			variations = data;
			errorMessage = null;
			return data;
		} catch {
			errorMessage = "Couldn't load variations — try again.";
			throw new Error('load failed');
		} finally {
			loadingVariations = false;
		}
	}

	async function toggleExpanded() {
		expanded = !expanded;
		if (expanded) {
			try {
				await ensureVariationsLoaded();
			} catch {
				// errorMessage is already set inside ensureVariationsLoaded.
			}
		}
	}

	async function postExclusion(variationKeys: string[], included: boolean): Promise<boolean> {
		try {
			const res = await fetch(`/api/repertoires/${rep.id}/exclusions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys, included })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function toggleVariation(key: string) {
		let list: VariationRow[];
		try {
			list = await ensureVariationsLoaded();
		} catch {
			return;
		}
		const target = list.find((v) => v.variationKey === key);
		if (!target) return;
		const nextIncluded = !target.included;
		variations = list.map((v) => (v.variationKey === key ? { ...v, included: nextIncluded } : v));
		const ok = await postExclusion([key], nextIncluded);
		if (!ok) {
			variations = list;
			errorMessage = "Couldn't update that — try again.";
		} else {
			errorMessage = null;
		}
	}

	async function toggleParent() {
		let list: VariationRow[];
		try {
			list = await ensureVariationsLoaded();
		} catch {
			return;
		}

		if (parentState !== 'unchecked') {
			// Checked or indeterminate -> bulk-exclude everything, remembering
			// exactly which ones were included so a re-check can restore them.
			// Only the currently-included keys are posted — an already-excluded
			// variation doesn't need a redundant write.
			const included = list.filter((v) => v.included).map((v) => v.variationKey);
			const previousSnapshot = uncheckSnapshot;
			uncheckSnapshot = new Set(included);
			variations = list.map((v) => ({ ...v, included: false }));
			const ok = await postExclusion(included, false);
			if (!ok) {
				variations = list;
				uncheckSnapshot = previousSnapshot;
				errorMessage = "Couldn't update that — try again.";
			} else {
				errorMessage = null;
			}
			return;
		}

		// Unchecked -> restore the pre-uncheck selection if we have one from
		// this visit, otherwise default to including everything.
		const toInclude = uncheckSnapshot ?? new Set(list.map((v) => v.variationKey));
		const previousSnapshot = uncheckSnapshot;
		variations = list.map((v) => ({ ...v, included: toInclude.has(v.variationKey) }));
		uncheckSnapshot = null;
		const ok = await postExclusion([...toInclude], true);
		if (!ok) {
			variations = list;
			uncheckSnapshot = previousSnapshot;
			errorMessage = "Couldn't update that — try again.";
		} else {
			errorMessage = null;
		}
	}
</script>

<li class="bg-white rounded-xl border border-gray-200 shadow-sm">
	<div class="flex items-center gap-3 p-4">
		<label class="flex items-center shrink-0">
			<input
				type="checkbox"
				checked={parentState === 'checked'}
				use:indeterminate={parentState === 'indeterminate'}
				onchange={toggleParent}
				aria-label={`Include ${rep.name} in practice`}
			/>
		</label>
		<button
			type="button"
			onclick={toggleExpanded}
			aria-label={expanded ? `Collapse ${rep.name}` : `Expand ${rep.name}`}
			class="text-gray-400 shrink-0 w-4"
		>
			{expanded ? '▾' : '▸'}
		</button>
		<a href="/practice/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
			<span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"
			></span>
			<div class="flex-1 min-w-0">
				<h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
				<p class="text-sm text-gray-400">
					{#if rep.totalVariations === 0}
						No moves yet
					{:else if rep.level === 'mastered'}
						🏆 Mastered · {levelTag(rep.totalLevels, rep.totalLevels)}
					{:else}
						Level {rep.level} of {rep.totalLevels} · {levelTag(rep.level, rep.totalLevels)} · {rep.levelSolvedCount}/{rep.levelTaskCount}
						solved
					{/if}
				</p>
			</div>
			<span class="text-gray-400 text-sm">→</span>
		</a>
	</div>

	{#if errorMessage}
		<p class="px-4 pb-2 text-xs text-red-600">{errorMessage}</p>
	{/if}

	{#if expanded}
		<ul class="pl-14 pr-4 pb-3 space-y-1">
			{#if loadingVariations}
				<li class="text-sm text-gray-400">Loading variations…</li>
			{:else}
				{#each variations ?? [] as variation (variation.variationKey)}
					<li>
						<label class="flex items-center gap-2 text-sm text-gray-700">
							<input
								type="checkbox"
								checked={variation.included}
								onchange={() => toggleVariation(variation.variationKey)}
							/>
							{variation.label}
						</label>
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</li>
