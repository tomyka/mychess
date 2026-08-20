<!-- mychess/src/lib/components/RepertoireVariationTree.svelte -->
<!--
	The expanded half of one repertoire's practice picker: the chapter /
	move-group / variation checkbox tree. `RepertoirePracticeRow` owns the
	collapsed summary row and the expand toggle, and hands the shared
	`VariationSelection` down so both halves read and write exactly the same
	rows (see that class's doc comment).
-->
<script lang="ts">
	import {
		groupByFirstMoves,
		moveSequenceLabel,
		chapterTiers,
		rowsInChapterTier,
		isInChapterTier,
		UNTAGGED_CHAPTER,
		FIRST_MOVES_GROUP_PLIES,
		type MoveGroup
	} from '$lib/mastery/variations';
	import type { VariationRow, VariationSelection } from '$lib/mastery/variationSelection.svelte';
	import { aggregateState, checkboxState } from './checkboxState';
	import { SvelteSet } from 'svelte/reactivity';

	let { selection, repName }: { selection: VariationSelection; repName: string } = $props();

	const TOP_N = 5;

	// Chapter names currently drilled into to show their move-group buckets.
	// A Set (not a single value) since this is a checklist screen, not a
	// pick-one wizard — more than one chapter can reasonably be open at once.
	let openChapters = new SvelteSet<string>();
	// Move-group buckets currently drilled into to show their individual
	// variations, keyed by `moveGroupKey` (chapter + the bucket's own first-5-
	// moves key) so the same key under two different chapters — or under the
	// flat, chapterless pool — never collide.
	let openMoveGroups = new SvelteSet<string>();

	// Chapters in first-appearance order, with the untagged bucket last (only
	// when some row is untagged). null means no loaded variation carries a
	// chapter tag at all — the chapter tier is skipped entirely and move-groups
	// apply directly to the whole (flat) repertoire. Shared with
	// VariationPicker via `chapterTiers` so the two components can never
	// disagree about what counts as "chaptered."
	const chapters = $derived.by<string[] | null>(() => chapterTiers(selection.variations ?? []));

	// `null` is the flat, chapterless pool (only reachable when `chapters` is
	// null) — distinct from the untagged bucket WITHIN a chaptered repertoire,
	// which is a real tier name like any other.
	function rowsForChapter(chapter: string | null): VariationRow[] {
		const rows = selection.variations ?? [];
		return chapter === null ? rows : rowsInChapterTier(rows, chapter);
	}

	function moveGroups(chapter: string | null): MoveGroup<VariationRow>[] {
		return groupByFirstMoves(rowsForChapter(chapter), (row) => row.path, FIRST_MOVES_GROUP_PLIES, TOP_N);
	}

	function groupLabel(group: MoveGroup<VariationRow>): string {
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : 'Other';
	}

	function moveGroupKey(chapter: string | null, group: MoveGroup<VariationRow>): string {
		const key = group.steps.map((s) => s.san).join('>') || `other:${group.items.map((v) => v.variationKey).sort().join('|')}`;
		return `${chapter ?? ''}::${key}`;
	}

	/** Qualifies a move-group's own label/aria-text with its parent chapter (or the repertoire name, when there's no chapter tier) so two same-named buckets never read identically. */
	function moveGroupQualifier(chapter: string | null): string {
		return chapter ?? repName;
	}

	// The untagged bucket sits in the chapter tier but isn't a chapter, so it
	// reads as its own plain label instead of being suffixed like one
	// ("Lines without a chapter", not "Lines without a chapter (chapter)").
	function chapterHeading(chapter: string): string {
		return chapter === UNTAGGED_CHAPTER ? chapter : `${chapter} (chapter)`;
	}

	function chapterExpandTarget(chapter: string): string {
		return chapter === UNTAGGED_CHAPTER ? chapter : `${chapter} chapter`;
	}

	function lineCount(n: number): string {
		return `· ${n} ${n === 1 ? 'line' : 'lines'}`;
	}

	function toggleChapterOpen(chapter: string) {
		if (!openChapters.delete(chapter)) openChapters.add(chapter);
	}

	function toggleMoveGroupOpen(key: string) {
		if (!openMoveGroups.delete(key)) openMoveGroups.add(key);
	}

	// Membership, not equality: a line shared by two chapters is one row
	// belonging to both, so toggling either chapter must pick it up — and the
	// untagged bucket toggles exactly the rows belonging to no chapter.
	function toggleChapter(chapter: string) {
		return selection.toggleGroup(`chapter:${chapter}`, (v) => isInChapterTier(v, chapter));
	}

	function toggleMoveGroup(chapter: string | null, group: MoveGroup<VariationRow>) {
		const keys = new Set(group.items.map((r) => r.variationKey));
		return selection.toggleGroup(`moveGroup:${moveGroupKey(chapter, group)}`, (row) => keys.has(row.variationKey));
	}
</script>

<!--
	One move-group bucket, rendered identically whether it sits directly in the
	flat chapterless pool (`chapter: null`) or one level down inside a chapter
	tier — the two used to be near-verbatim copies of each other, free to
	drift. `spacedTop` is the only real difference: the flat branch's buckets
	are top-level list items needing their own top margin, while a chapter's
	are already inset under its heading.
-->
{#snippet moveGroupNode(chapter: string | null, group: MoveGroup<VariationRow>, spacedTop: boolean)}
	<li>
		<div class="flex items-center gap-2 {spacedTop ? 'mt-2' : ''}">
			<label class="flex items-center shrink-0">
				<input
					type="checkbox"
					use:checkboxState={aggregateState(group.items)}
					onchange={() => toggleMoveGroup(chapter, group)}
					aria-label={`Include ${groupLabel(group)} in ${moveGroupQualifier(chapter)} in practice`}
				/>
			</label>
			<button
				type="button"
				onclick={() => toggleMoveGroupOpen(moveGroupKey(chapter, group))}
				aria-label={`${openMoveGroups.has(moveGroupKey(chapter, group)) ? 'Collapse' : 'Expand'} ${groupLabel(group)} in ${moveGroupQualifier(chapter)}`}
				class="text-(--color-muted) shrink-0 w-4"
			>
				{openMoveGroups.has(moveGroupKey(chapter, group)) ? '▾' : '▸'}
			</button>
			<span class="text-sm font-medium text-(--color-muted)">
				{groupLabel(group)}
				<span class="text-(--color-muted) font-normal">{lineCount(group.items.length)}</span>
			</span>
		</div>
		{#if openMoveGroups.has(moveGroupKey(chapter, group))}
			<ul class="pl-6 mt-1 space-y-1">
				{#each group.items as variation (variation.variationKey)}
					<li>
						<label class="flex items-center gap-2 text-sm text-(--color-text)">
							<input
								type="checkbox"
								checked={variation.included}
								onchange={() => selection.toggleVariation(variation.variationKey)}
							/>
							{variation.label}
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<ul class="pl-14 pr-4 pb-3 space-y-1">
	{#if selection.loading}
		<li class="text-sm text-(--color-muted)">Loading variations…</li>
	{:else if chapters === null}
		{#each moveGroups(null) as group (moveGroupKey(null, group))}
			{@render moveGroupNode(null, group, true)}
		{/each}
	{:else}
		{#each chapters as chapter (chapter)}
			<li>
				<div class="flex items-center gap-2 mt-2">
					<label class="flex items-center shrink-0">
						<input
							type="checkbox"
							use:checkboxState={aggregateState(rowsForChapter(chapter))}
							onchange={() => toggleChapter(chapter)}
							aria-label={`Include ${chapterHeading(chapter)} in practice`}
						/>
					</label>
					<button
						type="button"
						onclick={() => toggleChapterOpen(chapter)}
						aria-label={`${openChapters.has(chapter) ? 'Collapse' : 'Expand'} ${chapterExpandTarget(chapter)}`}
						class="text-(--color-muted) shrink-0 w-4"
					>
						{openChapters.has(chapter) ? '▾' : '▸'}
					</button>
					<span class="text-sm font-medium text-(--color-muted)">
						{chapterHeading(chapter)}
						<span class="text-(--color-muted) font-normal">
							{lineCount(rowsForChapter(chapter).length)}
						</span>
					</span>
				</div>
				{#if openChapters.has(chapter)}
					<ul class="pl-6 mt-1 space-y-1">
						{#each moveGroups(chapter) as group (moveGroupKey(chapter, group))}
							{@render moveGroupNode(chapter, group, false)}
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	{/if}
</ul>
