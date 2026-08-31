<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import {
		groupByFirstMoves,
		groupByCeilingPrefix,
		moveSequenceLabel,
		chapterTiers,
		rowsInChapterTier,
		FIRST_MOVES_GROUP_PLIES,
		UNTAGGED_CHAPTER,
		type MoveGroup,
		type VariationStep
	} from '$lib/mastery/variations';
	import { ceilingPlyFor } from '$lib/mastery/teaching';
	import { m } from '$lib/paraglide/messages';
	import { isIncludedFor } from '$lib/mastery/variationSelection.svelte';

	type VariationRow = {
		variationKey: string;
		label: string;
		// One entry per chapter this line belongs to (a single UNTAGGED_CHAPTER
		// entry for a genuinely untagged line) — GitHub issue #86. This picker
		// is read-only (it never toggles inclusion, only lists what's
		// practiceable), so it only ever needs the "truly included" aggregate
		// (`isIncludedFor(row, null)`), never a single chapter's own entry.
		includedByChapter: Record<string, boolean>;
		// Every chapter this line belongs to — a line cross-referenced by two
		// chapters shows under both. Empty means untagged (see UNTAGGED_CHAPTER).
		chapterNames: string[];
		path: VariationStep[];
		solved: boolean;
		// Server-computed (see `/api/repertoires/[id]/variations`): true when this
		// variation sits above the player's current level. Never true alongside
		// `solved` — a solved line is by definition already reachable. This UI
		// disables and explains, purely as a courtesy; the real gate is
		// `/api/practice/select-variation`'s 403 (GitHub issue #163).
		locked: boolean;
		// This repertoire's current teaching-tier ceiling — the same value on
		// every row (see the server route's doc comment). Used to decide which
		// rows extend past what's currently teachable, and to clip their
		// display to that point (GitHub issue #165).
		ceilingMoveCount: number;
	};

	// One entry in the rendered move-group list: either a fixed-window bucket
	// from `groupByFirstMoves` (today's behavior, for anything already fully
	// within reach) or a ceiling-clipped bucket from `groupByCeilingPrefix`
	// (for variations that currently extend past the teaching ceiling —
	// GitHub issue #165). A tagged union, not two parallel arrays, so the
	// template renders one combined list in one pass.
	type PickerEntry = { kind: 'ceiling'; group: MoveGroup<VariationRow> } | { kind: 'regular'; group: MoveGroup<VariationRow> };

	let {
		repertoireId,
		onselect,
		onselectchapter = onselect,
		onclose,
		variant = 'modal',
		currentVariationKey = null
	}: {
		repertoireId: string;
		onselect: (variationKey: string) => void;
		// Called instead of `onselect` when a CHAPTER heading — not a specific
		// variation — is clicked, so a chapter click can start teaching a
		// representative variation without necessarily closing the picker the
		// way picking a specific variation does (GitHub issue #170). Defaults
		// to `onselect` for callers that don't care about the distinction.
		onselectchapter?: (variationKey: string) => void;
		onclose?: () => void;
		// 'modal' (default) is the existing overlay, used on mobile everywhere
		// and as the "Switch variation" entry point on desktop too. 'inline'
		// renders as a permanent panel instead (GitHub issue #93's desktop
		// rail) — no backdrop, no close button, and it auto-opens to whatever
		// tier holds `currentVariationKey` instead of always starting
		// collapsed, since a permanent panel that's still hiding the current
		// line behind two clicks isn't earning its keep.
		variant?: 'modal' | 'inline';
		currentVariationKey?: string | null;
	} = $props();

	const TOP_N = 5;

	let variations = $state<VariationRow[] | null>(null);
	let openChapter = $state<string | null>(null);
	// Index into the currently-shown entry list, not the entry's own identity —
	// an index cleanly distinguishes "nothing opened yet" (`null`) from "the
	// Other bucket is opened" (an empty-steps group, but a real index), which
	// two otherwise-equal values couldn't.
	let openGroupIndex = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);
	// Whether the auto-open below has already run for the current
	// `currentVariationKey` — otherwise every subsequent load() (e.g. a
	// re-fetch after selecting a variation) would snap the rail back to the
	// active line even after the player had manually navigated elsewhere.
	let autoOpenedFor = $state<string | null>(null);

	function stepsOf(row: VariationRow): VariationStep[] {
		return row.path;
	}

	/**
	 * A variation whose own path currently extends past what Learn will teach
	 * — whether it's already paused there or simply hasn't reached it yet —
	 * so the picker never shows moves beyond the ceiling and never asks the
	 * player to separately visit several variations that share the exact same
	 * not-yet-reachable prefix (GitHub issue #165). A solved variation is
	 * never a frontier row: it's already past anything a ceiling could
	 * withhold.
	 */
	function isFrontier(row: VariationRow, ceilingMoveCount: number): boolean {
		return !row.solved && ceilingPlyFor(row.path, ceilingMoveCount) < row.path.length;
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
		return (variations ?? []).filter((r) => isIncludedFor(r, null));
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

	/**
	 * The entries shown for one chapter (or the flat pool): every frontier row
	 * grouped by its ceiling-clipped shared prefix FIRST (the actionable "what
	 * do I still need to do" content), then everything else through the
	 * existing fixed-window grouping — unchanged from before this feature.
	 */
	function pickerEntries(chapter: string | null): PickerEntry[] {
		const rows = rowsForChapter(chapter);
		// Every row carries the same repertoire-wide ceiling (see the server
		// route) — read it off the first row rather than a separate prop, so
		// the response can stay the flat array `VariationSelection` also
		// consumes. Defaults to Infinity (nothing is ever "past the ceiling")
		// for an empty chapter, which is never actually rendered.
		const ceilingMoveCount = rows[0]?.ceilingMoveCount ?? Infinity;
		const frontierRows = rows.filter((r) => isFrontier(r, ceilingMoveCount));
		const regularRows = rows.filter((r) => !isFrontier(r, ceilingMoveCount));
		const ceilingGroups = groupByCeilingPrefix(frontierRows, stepsOf, ceilingMoveCount);
		const regularGroups = groupByFirstMoves(regularRows, stepsOf, FIRST_MOVES_GROUP_PLIES, TOP_N);
		return [
			...ceilingGroups.map((group) => ({ kind: 'ceiling' as const, group })),
			...regularGroups.map((group) => ({ kind: 'regular' as const, group }))
		];
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

	/** Whether every member of a ceiling group is already paused there — nothing left to practice until the tier ceiling itself advances. */
	function ceilingGroupDone(group: MoveGroup<VariationRow>): boolean {
		return group.items.every((r) => r.locked);
	}

	/**
	 * The row to start teaching when the caller only has a SET of rows to
	 * choose from, not a specific one — a ceiling group's members (GitHub
	 * issue #165) or a chapter's own rows (GitHub issue #170). Same
	 * three-tier fallback both callers want: first unsolved-and-unlocked
	 * (always genuinely selectable), else first unsolved (locked, but at
	 * least not already done — the server will reject it, which is fine,
	 * see `applyVariationSelection`'s error handling on the Learn page),
	 * else just the first row (everything solved — still has to land on
	 * SOMETHING for a re-drill). Mirrors the repertoire-wide equivalent,
	 * `pickActiveVariation` in `mastery/variationSequence.ts`, which
	 * operates over the whole repertoire via separate solved/blocked Sets
	 * rather than a row array with its own booleans — different enough data
	 * shape that sharing one implementation across both wasn't worth it.
	 * `rows` empty only for a chapter heading the picker never actually
	 * renders (see `chapterTiers`), so the `undefined` case is unreachable
	 * in practice, not silently swallowed.
	 */
	function pickRepresentative(rows: VariationRow[]): VariationRow | undefined {
		return rows.find((r) => !r.solved && !r.locked) ?? rows.find((r) => !r.solved) ?? rows[0];
	}

	/** Solved/total across a chapter's own rows — the rail's per-chapter indicator. */
	function chapterProgress(chapter: string): { solved: number; total: number } {
		const rows = rowsInChapterTier(includedRows(), chapter);
		return { solved: rows.filter((r) => r.solved).length, total: rows.length };
	}

	function isActive(variationKey: string): boolean {
		return currentVariationKey !== null && variationKey === currentVariationKey;
	}

	function chapterHasActive(chapter: string): boolean {
		return currentVariationKey !== null && rowsInChapterTier(includedRows(), chapter).some((r) => isActive(r.variationKey));
	}

	function groupHasActive(group: MoveGroup<VariationRow>): boolean {
		return currentVariationKey !== null && group.items.some((r) => isActive(r.variationKey));
	}

	const activeChapter = $derived(chapters === null ? null : openChapter);
	const currentEntries = $derived(activeChapter !== null || chapters === null ? pickerEntries(activeChapter) : []);
	const openEntry = $derived(openGroupIndex !== null ? currentEntries[openGroupIndex] ?? null : null);
	// Only a 'regular' entry can ever be drilled into — a ceiling entry always
	// selects directly (see the template), so it never sets `openGroupIndex`.
	const openGroup = $derived(openEntry?.kind === 'regular' ? openEntry.group : null);

	// Inline-only (see the `variant` prop doc comment above): opens straight to
	// whatever tier holds the active line instead of leaving a permanent panel
	// sitting on its collapsed top level.
	$effect(() => {
		if (variant !== 'inline' || !currentVariationKey || !variations) return;
		if (autoOpenedFor === currentVariationKey) return;
		const row = variations.find((v) => v.variationKey === currentVariationKey);
		if (!row) return;
		autoOpenedFor = currentVariationKey;
		const chapter = chapters === null ? null : row.chapterNames[0] ?? UNTAGGED_CHAPTER;
		openChapter = chapter;
		const entries = pickerEntries(chapter);
		const idx = entries.findIndex((e) => e.group.items.some((r) => r.variationKey === currentVariationKey));
		const found = idx >= 0 ? entries[idx] : null;
		// A ceiling entry (any size) and a regular group-of-one already render
		// their row directly in the entry list — drilling in would just show
		// the same row again behind a pointless "Back".
		openGroupIndex = found && found.kind === 'regular' && !soleVariation(found.group) ? idx : null;
	});
</script>

{#snippet body()}
	<div class="flex items-center justify-between mb-3">
		<h2 class="font-bold text-(--color-text)">{m.variation_picker_heading()}</h2>
		{#if variant === 'modal'}
			<button aria-label={m.picker_close_aria()} onclick={onclose} class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400">✕</button>
		{/if}
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
						disabled={row.locked}
						onclick={() => {
							if (!row.locked) onselect(row.variationKey);
						}}
						class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between {isActive(row.variationKey)
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''} {row.locked ? 'opacity-50 cursor-not-allowed' : ''}"
					>
						<span>{row.label}</span>
						{#if row.locked}
							<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
						{:else if row.solved}
							<span class="text-green-600 dark:text-green-400 text-sm">✓</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if activeChapter !== null || chapters === null}
		{#if chapters !== null}
			<button onclick={() => (openChapter = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
		{/if}
		<ul class="space-y-1">
			{#each currentEntries as entry, i (entry.kind === 'ceiling' ? `ceiling-${entry.group.steps.map((s) => s.moveId).join('>')}` : entry.group.steps.map((s) => s.san).join('>') || `other-${i}`)}
				{#if entry.kind === 'ceiling'}
					{@const done = ceilingGroupDone(entry.group)}
					<li>
						<button
							disabled={done}
							onclick={() => {
								if (!done) {
									const representative = pickRepresentative(entry.group.items);
									if (representative) onselect(representative.variationKey);
								}
							}}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between font-medium {groupHasActive(entry.group)
								? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
								: ''} {done ? 'opacity-50 cursor-not-allowed' : ''}"
						>
							<span>{moveSequenceLabel(entry.group.steps)}</span>
							<span class="flex items-center gap-2 shrink-0">
								{#if entry.group.items.length > 1}
									<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
								{/if}
								{#if done}
									<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
								{/if}
							</span>
						</button>
					</li>
				{:else}
					{@const only = soleVariation(entry.group)}
					<li>
						<!-- A group of one IS a variation, so it selects straight into
						     practice and renders like a variation row (own full label,
						     solved tick, no count) rather than as a folder holding one
						     item. Groups of several still drill in. -->
						<button
							disabled={only?.locked ?? false}
							onclick={() => {
								if (only) {
									if (!only.locked) onselect(only.variationKey);
								} else {
									openGroupIndex = i;
								}
							}}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between {only
								? ''
								: 'font-medium'} {groupHasActive(entry.group) ? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10' : ''} {only?.locked
								? 'opacity-50 cursor-not-allowed'
								: ''}"
						>
							<span>{only ? only.label : groupLabel(entry.group)}</span>
							{#if only}
								{#if only.locked}
									<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
								{:else if only.solved}
									<span class="text-green-600 dark:text-green-400 text-sm">✓</span>
								{/if}
							{:else}
								<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
							{/if}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{:else}
		<ul class="space-y-1">
			{#each chapters ?? [] as chapter (chapter)}
				{@const progress = variant === 'inline' ? chapterProgress(chapter) : null}
				<li>
					<button
						onclick={() => {
							openChapter = chapter;
							const representative = pickRepresentative(rowsInChapterTier(includedRows(), chapter));
							if (representative) onselectchapter(representative.variationKey);
						}}
						class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-(--color-text) flex items-center justify-between gap-2 {chapterHasActive(chapter)
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''}"
					>
						<span class="truncate">{chapter}</span>
						{#if progress}
							<span class="shrink-0 text-xs font-normal {progress.solved === progress.total ? 'text-green-600 dark:text-green-400' : 'text-(--color-muted)'}">
								{progress.solved === progress.total ? '✓' : `${progress.solved}/${progress.total}`}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if variant === 'modal'}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
		<div class="bg-(--color-surface) rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
			{@render body()}
		</div>
	</div>
{:else}
	<div class="h-full flex flex-col bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm overflow-y-auto p-4">
		{@render body()}
	</div>
{/if}
