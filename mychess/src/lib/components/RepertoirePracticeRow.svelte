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
		// Whether this repertoire has any chapter-tagged variation at all. When
		// false, there's nothing coarser than "the whole repertoire" to select
		// by (see #58's "just chapters" simplification) — no checkbox or
		// expand control renders at all, and the full repertoire is always
		// practiced with nothing excluded.
		hasChapters: boolean;
	};
	type VariationRow = { variationKey: string; label: string; included: boolean; chapterName: string | null };
	type ChapterGroup = { chapterName: string | null; rows: VariationRow[] };

	let { rep }: { rep: RepSummary } = $props();

	let expanded = $state(false);
	let variations = $state<VariationRow[] | null>(null);
	let loadingVariations = $state(false);
	let errorMessage = $state<string | null>(null);
	// Keyed by toggle scope ('__all__' for the repertoire-level checkbox, or
	// `chapter:{chapterName}` for one chapter's own checkbox) — the set of
	// variationKeys that were included right before that scope's checkbox
	// last bulk-excluded everything, so re-checking it restores exactly that
	// selection instead of blanket-including everything. Independent per
	// scope: bulk-excluding one chapter never touches another chapter's or
	// the repertoire-level checkbox's own snapshot.
	let snapshots = $state<Map<string, Set<string>>>(new Map());

	const checkedCount = $derived(
		variations ? variations.filter((v) => v.included).length : rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(variations ? variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	// Preserves first-seen order: a chapter's rows cluster together at the
	// position its first row appeared in `variations`; a null chapterName
	// (no chapter tag — every variation of a pre-feature or single-chapter
	// repertoire) becomes its OWN single-row group rather than one shared
	// group, so the template's ungrouped branch (no header, no wrapper)
	// reproduces today's flat rendering exactly when nothing is tagged.
	const groupedVariations = $derived.by<ChapterGroup[]>(() => {
		const list = variations ?? [];
		const groups: ChapterGroup[] = [];
		const indexByChapter = new Map<string, number>();
		for (const row of list) {
			if (row.chapterName === null) {
				groups.push({ chapterName: null, rows: [row] });
				continue;
			}
			const existingIndex = indexByChapter.get(row.chapterName);
			if (existingIndex === undefined) {
				indexByChapter.set(row.chapterName, groups.length);
				groups.push({ chapterName: row.chapterName, rows: [row] });
			} else {
				groups[existingIndex].rows.push(row);
			}
		}
		return groups;
	});

	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(newValue: boolean) {
				node.indeterminate = newValue;
			}
		};
	}

	/** Checked/unchecked/indeterminate aggregate for an arbitrary subset of variation rows. */
	function aggregateState(rows: VariationRow[]): 'checked' | 'unchecked' | 'indeterminate' {
		if (rows.length === 0) return 'checked';
		const included = rows.filter((v) => v.included).length;
		return included === rows.length ? 'checked' : included === 0 ? 'unchecked' : 'indeterminate';
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

	/**
	 * Bulk-toggles every currently-loaded variation for which `belongsToGroup`
	 * is true — used for both the repertoire-level checkbox (every variation)
	 * and each chapter header's own checkbox (just that chapter's rows).
	 * `scopeKey` isolates the uncheck/recheck snapshot per toggle so they
	 * never interfere with each other (see `snapshots`' doc comment above).
	 */
	async function toggleGroup(scopeKey: string, belongsToGroup: (row: VariationRow) => boolean) {
		let list: VariationRow[];
		try {
			list = await ensureVariationsLoaded();
		} catch {
			return;
		}
		const rows = list.filter(belongsToGroup);
		const state = aggregateState(rows);

		if (state !== 'unchecked') {
			// Checked or indeterminate -> bulk-exclude this scope's rows,
			// remembering exactly which ones were included so a re-check can
			// restore them. Only the currently-included keys are posted — an
			// already-excluded variation doesn't need a redundant write.
			const included = rows.filter((v) => v.included).map((v) => v.variationKey);
			const previousSnapshots = snapshots;
			snapshots = new Map(snapshots).set(scopeKey, new Set(included));
			variations = list.map((v) => (belongsToGroup(v) ? { ...v, included: false } : v));
			const ok = await postExclusion(included, false);
			if (!ok) {
				variations = list;
				snapshots = previousSnapshots;
				errorMessage = "Couldn't update that — try again.";
			} else {
				errorMessage = null;
			}
			return;
		}

		// Unchecked -> restore the pre-uncheck selection if we have one from
		// this visit, otherwise default to including everything in scope.
		const rowKeys = new Set(rows.map((v) => v.variationKey));
		const toInclude = snapshots.get(scopeKey) ?? rowKeys;
		const previousSnapshots = snapshots;
		variations = list.map((v) => (belongsToGroup(v) ? { ...v, included: toInclude.has(v.variationKey) } : v));
		const nextSnapshots = new Map(snapshots);
		nextSnapshots.delete(scopeKey);
		snapshots = nextSnapshots;
		const ok = await postExclusion([...toInclude], true);
		if (!ok) {
			variations = list;
			snapshots = previousSnapshots;
			errorMessage = "Couldn't update that — try again.";
		} else {
			errorMessage = null;
		}
	}

	function toggleParent() {
		return toggleGroup('__all__', () => true);
	}

	function toggleChapter(chapterName: string) {
		return toggleGroup(`chapter:${chapterName}`, (v) => v.chapterName === chapterName);
	}
</script>

<li class="bg-white rounded-xl border border-gray-200 shadow-sm">
	<div class="flex items-center gap-3 p-4">
		{#if rep.hasChapters}
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
		{/if}
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

	{#if rep.hasChapters && errorMessage}
		<p class="px-4 pb-2 text-xs text-red-600">{errorMessage}</p>
	{/if}

	{#if rep.hasChapters && expanded}
		<ul class="pl-14 pr-4 pb-3 space-y-1">
			{#if loadingVariations}
				<li class="text-sm text-gray-400">Loading variations…</li>
			{:else}
				{#each groupedVariations as group, i (group.chapterName ?? `_ungrouped_${i}`)}
					{#if group.chapterName}
						<li>
							<label class="flex items-center gap-2 text-sm font-medium text-gray-600 mt-2">
								<input
									type="checkbox"
									checked={aggregateState(group.rows) === 'checked'}
									use:indeterminate={aggregateState(group.rows) === 'indeterminate'}
									onchange={() => toggleChapter(group.chapterName ?? '')}
									aria-label={`Include ${group.chapterName} (chapter) in practice`}
								/>
								{group.chapterName} (chapter)
								<span class="text-gray-400 font-normal">· {group.rows.length} {group.rows.length === 1 ? 'line' : 'lines'}</span>
							</label>
						</li>
					{:else}
						{#each group.rows as variation (variation.variationKey)}
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
				{/each}
			{/if}
		</ul>
	{/if}
</li>
