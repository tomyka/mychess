<!-- mychess/src/lib/components/RepertoirePracticeRow.svelte -->
<script lang="ts">
	import { groupByFirstMoves, moveSequenceLabel, FIRST_MOVES_GROUP_PLIES, type MoveGroup, type VariationStep } from '$lib/mastery/variations';

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
		// component no longer gates on it — it derives the same fact live
		// from the loaded variations (`chapters` below), since a repertoire
		// without chapters is now just as selectable as one with them, only
		// skipping the chapter tier.
		hasChapters: boolean;
	};
	type VariationRow = {
		variationKey: string;
		label: string;
		included: boolean;
		chapterName: string | null;
		path: VariationStep[];
	};

	let { rep }: { rep: RepSummary } = $props();

	const TOP_N = 5;

	let expanded = $state(false);
	let variations = $state<VariationRow[] | null>(null);
	let loadingVariations = $state(false);
	let errorMessage = $state<string | null>(null);
	// Keyed by toggle scope ('__all__' for the repertoire-level checkbox,
	// `chapter:{chapterName}` for a chapter's own checkbox, or
	// `moveGroup:{chapterName}::{groupKey}` for a move-group bucket's own
	// checkbox) — the set of variationKeys that were included right before
	// that scope's checkbox last bulk-excluded everything, so re-checking it
	// restores exactly that selection instead of blanket-including everything.
	// Independent per scope: bulk-excluding one bucket never touches another
	// bucket's, chapter's, or the repertoire-level checkbox's own snapshot.
	let snapshots = $state<Map<string, Set<string>>>(new Map());
	// Chapter names currently drilled into to show their move-group buckets.
	// A Set (not a single value) since this is a checklist screen, not a
	// pick-one wizard — more than one chapter can reasonably be open at once.
	let openChapters = $state<Set<string>>(new Set());
	// Move-group buckets currently drilled into to show their individual
	// variations, keyed by `moveGroupKey` (chapter + the bucket's own first-5-
	// moves key) so the same key under two different chapters — or under the
	// flat, chapterless pool — never collide.
	let openMoveGroups = $state<Set<string>>(new Set());

	const checkedCount = $derived(
		variations ? variations.filter((v) => v.included).length : rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(variations ? variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	// null means no loaded variation carries a chapter tag at all — the
	// chapter tier is skipped entirely and move-groups apply directly to the
	// whole (flat) repertoire. Mirrors VariationPicker's identical rule so
	// the two components never disagree about what counts as "chaptered."
	const chapters = $derived.by<string[] | null>(() => {
		const rows = variations ?? [];
		if (rows.every((r) => r.chapterName === null)) return null;
		const names: string[] = [];
		for (const r of rows) {
			if (r.chapterName !== null && !names.includes(r.chapterName)) names.push(r.chapterName);
		}
		return names;
	});

	function rowsForChapter(chapterName: string | null): VariationRow[] {
		const rows = variations ?? [];
		return chapterName === null ? rows : rows.filter((r) => r.chapterName === chapterName);
	}

	function stepsOf(row: VariationRow): VariationStep[] {
		return row.path;
	}

	function moveGroups(chapterName: string | null): MoveGroup<VariationRow>[] {
		return groupByFirstMoves(rowsForChapter(chapterName), stepsOf, FIRST_MOVES_GROUP_PLIES, TOP_N);
	}

	function groupLabel(group: MoveGroup<VariationRow>): string {
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : 'Other';
	}

	function moveGroupKey(chapterName: string | null, group: MoveGroup<VariationRow>): string {
		const key = group.steps.map((s) => s.san).join('>') || `other:${group.items.map((v) => v.variationKey).sort().join('|')}`;
		return `${chapterName ?? ''}::${key}`;
	}

	/** Qualifies a move-group's own label/aria-text with its parent chapter (or the repertoire name, when there's no chapter tier) so two same-named buckets never read identically. */
	function moveGroupQualifier(chapterName: string | null): string {
		return chapterName ?? rep.name;
	}

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

	function toggleChapterOpen(chapterName: string) {
		const next = new Set(openChapters);
		if (next.has(chapterName)) next.delete(chapterName);
		else next.add(chapterName);
		openChapters = next;
	}

	function toggleMoveGroupOpen(key: string) {
		const next = new Set(openMoveGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		openMoveGroups = next;
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
	 * is true — used for the repertoire-level checkbox (every variation),
	 * each chapter header's own checkbox (just that chapter's rows), and each
	 * move-group bucket's own checkbox (just that bucket's rows). `scopeKey`
	 * isolates the uncheck/recheck snapshot per toggle so they never
	 * interfere with each other (see `snapshots`' doc comment above).
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

	function toggleMoveGroup(chapterName: string | null, group: MoveGroup<VariationRow>) {
		const keys = new Set(group.items.map((r) => r.variationKey));
		return toggleGroup(`moveGroup:${moveGroupKey(chapterName, group)}`, (row) => keys.has(row.variationKey));
	}
</script>

<li class="bg-white rounded-xl border border-gray-200 shadow-sm">
	<div class="flex items-center gap-3 p-4">
		{#if rep.fullVariationCount > 0}
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
					{#if rep.total === 0}
						No moves yet
					{:else if rep.allSolved}
						🏆 Solved · {rep.solved}/{rep.total}
					{:else}
						{rep.solved}/{rep.total} variations solved
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
			{:else if chapters === null}
				{#each moveGroups(null) as group (moveGroupKey(null, group))}
					<li>
						<div class="flex items-center gap-2 mt-2">
							<label class="flex items-center shrink-0">
								<input
									type="checkbox"
									checked={aggregateState(group.items) === 'checked'}
									use:indeterminate={aggregateState(group.items) === 'indeterminate'}
									onchange={() => toggleMoveGroup(null, group)}
									aria-label={`Include ${groupLabel(group)} in ${moveGroupQualifier(null)} in practice`}
								/>
							</label>
							<button
								type="button"
								onclick={() => toggleMoveGroupOpen(moveGroupKey(null, group))}
								aria-label={`${openMoveGroups.has(moveGroupKey(null, group)) ? 'Collapse' : 'Expand'} ${groupLabel(group)} in ${moveGroupQualifier(null)}`}
								class="text-gray-400 shrink-0 w-4"
							>
								{openMoveGroups.has(moveGroupKey(null, group)) ? '▾' : '▸'}
							</button>
							<span class="text-sm font-medium text-gray-600">
								{groupLabel(group)}
								<span class="text-gray-400 font-normal">· {group.items.length} {group.items.length === 1 ? 'line' : 'lines'}</span>
							</span>
						</div>
						{#if openMoveGroups.has(moveGroupKey(null, group))}
							<ul class="pl-6 mt-1 space-y-1">
								{#each group.items as variation (variation.variationKey)}
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
							</ul>
						{/if}
					</li>
				{/each}
			{:else}
				{#each chapters as chapterName (chapterName)}
					<li>
						<div class="flex items-center gap-2 mt-2">
							<label class="flex items-center shrink-0">
								<input
									type="checkbox"
									checked={aggregateState(rowsForChapter(chapterName)) === 'checked'}
									use:indeterminate={aggregateState(rowsForChapter(chapterName)) === 'indeterminate'}
									onchange={() => toggleChapter(chapterName)}
									aria-label={`Include ${chapterName} (chapter) in practice`}
								/>
							</label>
							<button
								type="button"
								onclick={() => toggleChapterOpen(chapterName)}
								aria-label={`${openChapters.has(chapterName) ? 'Collapse' : 'Expand'} ${chapterName} chapter`}
								class="text-gray-400 shrink-0 w-4"
							>
								{openChapters.has(chapterName) ? '▾' : '▸'}
							</button>
							<span class="text-sm font-medium text-gray-600">
								{chapterName} (chapter)
								<span class="text-gray-400 font-normal">
									· {rowsForChapter(chapterName).length} {rowsForChapter(chapterName).length === 1 ? 'line' : 'lines'}
								</span>
							</span>
						</div>
						{#if openChapters.has(chapterName)}
							<ul class="pl-6 mt-1 space-y-1">
								{#each moveGroups(chapterName) as group (moveGroupKey(chapterName, group))}
									<li>
										<div class="flex items-center gap-2">
											<label class="flex items-center shrink-0">
												<input
													type="checkbox"
													checked={aggregateState(group.items) === 'checked'}
													use:indeterminate={aggregateState(group.items) === 'indeterminate'}
													onchange={() => toggleMoveGroup(chapterName, group)}
													aria-label={`Include ${groupLabel(group)} in ${moveGroupQualifier(chapterName)} in practice`}
												/>
											</label>
											<button
												type="button"
												onclick={() => toggleMoveGroupOpen(moveGroupKey(chapterName, group))}
												aria-label={`${openMoveGroups.has(moveGroupKey(chapterName, group)) ? 'Collapse' : 'Expand'} ${groupLabel(group)} in ${moveGroupQualifier(chapterName)}`}
												class="text-gray-400 shrink-0 w-4"
											>
												{openMoveGroups.has(moveGroupKey(chapterName, group)) ? '▾' : '▸'}
											</button>
											<span class="text-sm font-medium text-gray-600">
												{groupLabel(group)}
												<span class="text-gray-400 font-normal">· {group.items.length} {group.items.length === 1 ? 'line' : 'lines'}</span>
											</span>
										</div>
										{#if openMoveGroups.has(moveGroupKey(chapterName, group))}
											<ul class="pl-6 mt-1 space-y-1">
												{#each group.items as variation (variation.variationKey)}
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
											</ul>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</li>
