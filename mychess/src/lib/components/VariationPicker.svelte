<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import { groupByFirstMoves, moveSequenceLabel, FIRST_MOVES_GROUP_PLIES, type MoveGroup } from '$lib/mastery/variations';
	import type { Band, LearnChapterView, LearnUnitView, LearnUnitsResponse } from '$lib/mastery/learnUnits';
	import { m } from '$lib/paraglide/messages';

	// The wire types come from `$lib/mastery/learnUnits`, shared with the route
	// that produces them, so a field rename can't drift between the two.
	//
	// Every unit here is learnable RIGHT NOW (GitHub issue #182): there is no
	// locked, paused, deferred or already-learned state to render, because a
	// learned unit is simply absent from the response. Hence no status icon and
	// no `disabled` anywhere in this component.

	const BAND_LABEL: Record<Band, () => string> = {
		bronze: m.level_bronze,
		silver: m.level_silver,
		gold: m.level_gold,
		platinum: m.level_platinum
	};

	let {
		repertoireId,
		onselect,
		onselectchapter = onselect,
		onclose,
		variant = 'modal',
		currentVariationKey = null,
		attemptsCompleted = 0
	}: {
		repertoireId: string;
		onselect: (variationKey: string) => void;
		// Called instead of `onselect` when a CHAPTER heading — not a specific
		// unit — is clicked, so a chapter click can start teaching a
		// representative unit without necessarily closing the picker the way
		// picking a specific unit does (GitHub issue #170). Defaults to
		// `onselect` for callers that don't care about the distinction.
		onselectchapter?: (variationKey: string) => void;
		onclose?: () => void;
		// 'modal' (default) is the existing overlay, used on mobile everywhere
		// and as the "Switch variation" entry point on desktop too. 'inline'
		// renders as a permanent panel instead (GitHub issue #93's desktop
		// rail) — no backdrop, no close button, and it auto-opens to whatever
		// chapter holds `currentVariationKey` instead of always starting
		// collapsed, since a permanent panel that's still hiding the current
		// line behind two clicks isn't earning its keep.
		variant?: 'modal' | 'inline';
		currentVariationKey?: string | null;
		// Bumped by the Learn page on every COMPLETED attempt, whether or not
		// the active line moved (GitHub issue #176). `currentVariationKey`
		// alone is not a sufficient staleness signal: shared move-prefix credit
		// means progress on the active unit can finish a DIFFERENT sibling unit
		// outright, removing it from this list, while the active unit is still
		// being served and the pointer never moves.
		attemptsCompleted?: number;
	} = $props();

	const TOP_N = 5;

	let chapters = $state<LearnChapterView[] | null>(null);
	let openChapter = $state<string | null>(null);
	// The open folder's own STABLE, content-based identity (its shared SAN
	// chain), not its index: the entry list reorders as teaching advances
	// (see `folders`), so an index captured at click time can point at a
	// different folder a moment later. Keying by content means this always
	// resolves to the SAME logical folder, or to `null` once it's gone.
	let openFolderKey = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	// Whether the auto-open below has already run for the current
	// `currentVariationKey` — otherwise every subsequent load() would snap the
	// rail back to the active line even after the player navigated elsewhere.
	let autoOpenedFor = $state<string | null>(null);

	// Bumped on every load() call so an out-of-order response (a slow first
	// fetch resolving after a newer one already landed) can't overwrite
	// fresher data with stale data.
	let loadToken = 0;

	// Both arguments are unused inside — `load` always fetches every chapter
	// regardless of which unit is active — but taking them as real arguments
	// (rather than bare `void`'d reads in the caller) is what makes the
	// `$effect` below read as "re-run this when the active variation changes,
	// or when any attempt completes," matching this codebase's existing pattern
	// for the same shape of problem (see `requestIfDue(fen)` in `EvalBar.svelte`).
	async function load(_currentVariationKey: string | null, _attemptsCompleted: number) {
		const myToken = ++loadToken;
		try {
			const res = await fetch(`/api/repertoires/${repertoireId}/learn-units`);
			if (!res.ok) throw new Error('load failed');
			const data = (await res.json()) as LearnUnitsResponse;
			if (myToken !== loadToken) return;
			chapters = data.chapters;
			errorMessage = null;
		} catch {
			if (myToken !== loadToken) return;
			errorMessage = m.variation_picker_load_error();
		}
	}

	/**
	 * Re-fetches whenever the active variation changes OR any attempt completes,
	 * not just once at mount — GitHub issues #175 and #176. The inline rail is
	 * resident for the player's whole Learn session and never remounts, so
	 * without this its unit list goes stale as teaching progresses. Now that
	 * learned units DISAPPEAR rather than being re-rendered with a tick, a stale
	 * list is more visible than it used to be, not less.
	 *
	 * `currentVariationKey` alone was the original signal (#175), on the
	 * reasoning that finishing a unit always advances the active pointer. True
	 * of the unit being attempted, but not of its siblings: mastered moves are
	 * credited across every unit that shares them, so progress on the active
	 * unit can finish a sibling unit outright — removing it from this list —
	 * while the active unit is still being served and the pointer never moves
	 * (#176). Clicking such a stale row is what `select-variation`'s 409
	 * "already learned" guard catches, so it has to stop being reachable here.
	 *
	 * A harmless no-op for the modal variant, which remounts every time it
	 * opens.
	 */
	$effect(() => {
		load(currentVariationKey, attemptsCompleted);
	});

	// Only chapters with something left to learn are offered: a complete
	// chapter has no unit to click, so listing it would be a dead end. This is
	// the same rule as within a chapter — learned content is absent, not
	// disabled.
	const openChapters = $derived((chapters ?? []).filter((c) => c.units.length > 0));

	// `null` skips the chapter tier entirely — a repertoire with no chapters
	// anywhere is one flat pool (the API's single `chapter: null` entry), and a
	// single named chapter is not worth a click either.
	const chapterList = $derived(openChapters.length > 1 || openChapters.some((c) => c.chapter !== null) ? openChapters : null);

	const activeChapter = $derived.by(() => {
		if (chapterList === null) return openChapters[0] ?? null;
		return openChapters.find((c) => c.chapter === openChapter) ?? null;
	});

	/**
	 * The current chapter's units bucketed by their shared opening moves, with
	 * the folder holding the currently-taught unit floated to the front
	 * (GitHub issue #178) — "what am I being taught right now" is a different
	 * question from "what is there to browse", and the answer to the first
	 * should never be sorted below a dozen answers to the second.
	 *
	 * Grouping is over the CLIPPED unit paths, so a folder's shared prefix is
	 * genuinely shared by everything in it.
	 */
	const folders = $derived.by(() => {
		const units = activeChapter?.units ?? [];
		const groups = groupByFirstMoves(units, (u) => u.path, FIRST_MOVES_GROUP_PLIES, TOP_N);
		if (currentVariationKey === null) return groups;
		const activeIndex = groups.findIndex((g) => g.items.some((u) => u.variationKey === currentVariationKey));
		if (activeIndex <= 0) return groups;
		const reordered = groups.slice();
		reordered.unshift(...reordered.splice(activeIndex, 1));
		return reordered;
	});

	/**
	 * A stable, content-based identity for one folder — shared by the
	 * template's `{#each}` key and `openFolderKey`, so both agree on what makes
	 * two folders "the same one" across a reorder. The fixed string `'other'`
	 * covers `groupByFirstMoves`'s trailing catch-all bucket (`steps: []`); it
	 * can't collide with a real folder's key, since SAN grammar can't spell
	 * "other".
	 */
	function folderKey(group: MoveGroup<LearnUnitView>): string {
		return group.steps.map((s) => s.san).join('>') || 'other';
	}

	const openFolder = $derived(openFolderKey !== null ? (folders.find((g) => folderKey(g) === openFolderKey) ?? null) : null);

	function groupLabel(group: MoveGroup<LearnUnitView>): string {
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : m.variation_picker_other_group_label();
	}

	/**
	 * The single unit a folder holds, or null if it holds several.
	 *
	 * A folder's button is labelled with its shared opening moves, so a folder
	 * of one reads as a unit already — drilling into it just showed a list of
	 * one row with a near-identical label. Folders of one are therefore
	 * selected directly, skipping a tier that carried no new information.
	 */
	function soleUnit(group: MoveGroup<LearnUnitView>): LearnUnitView | null {
		return group.items.length === 1 ? group.items[0] : null;
	}

	function isActive(variationKey: string): boolean {
		return currentVariationKey !== null && variationKey === currentVariationKey;
	}

	function chapterHasActive(chapter: LearnChapterView): boolean {
		return chapter.units.some((u) => isActive(u.variationKey));
	}

	function groupHasActive(group: MoveGroup<LearnUnitView>): boolean {
		return group.items.some((u) => isActive(u.variationKey));
	}

	/**
	 * Scrolls a row/folder button into view the moment it BECOMES the one
	 * currently being taught — GitHub issue #174.
	 *
	 * Re-scrolls on a false→true transition (`update`), not just on mount — an
	 * already-open folder can have the active unit advance to a DIFFERENT row
	 * inside it, a no-remount case a mount-only action would miss.
	 * Deliberately does NOT re-scroll on every call where `active` stays true,
	 * or a still-active row would keep fighting the player's own manual
	 * scrolling on every unrelated reactive update.
	 */
	function scrollIntoViewIfActive(node: HTMLElement, active: boolean) {
		let wasActive = false;
		const maybeScroll = (nowActive: boolean) => {
			// Optional chaining: jsdom (component tests) doesn't implement
			// `scrollIntoView` at all, unlike a real browser.
			if (nowActive && !wasActive) node.scrollIntoView?.({ block: 'nearest' });
			wasActive = nowActive;
		};
		maybeScroll(active);
		return { update: maybeScroll };
	}

	// Inline-only (see the `variant` prop doc comment above): opens straight to
	// whatever chapter holds the active line instead of leaving a permanent
	// panel sitting on its collapsed top level.
	$effect(() => {
		if (variant !== 'inline' || !currentVariationKey || !chapters) return;
		if (autoOpenedFor === currentVariationKey) return;
		const holder = openChapters.find((c) => c.units.some((u) => u.variationKey === currentVariationKey));
		if (!holder) return;
		autoOpenedFor = currentVariationKey;
		openChapter = holder.chapter;
		const groups = groupByFirstMoves(holder.units, (u) => u.path, FIRST_MOVES_GROUP_PLIES, TOP_N);
		const found = groups.find((g) => g.items.some((u) => u.variationKey === currentVariationKey)) ?? null;
		// A folder of one already renders its row directly in the folder list —
		// drilling in would just show the same row again behind a pointless
		// "Back".
		openFolderKey = found && !soleUnit(found) ? folderKey(found) : null;
	});
</script>

{#snippet bandChip(chapter: LearnChapterView)}
	{#if chapter.band}
		<span class="shrink-0 text-xs font-normal text-(--color-muted)">
			{BAND_LABEL[chapter.band]()} · {chapter.learnedInBand}/{chapter.totalInBand}
		</span>
	{/if}
{/snippet}

{#snippet body()}
	<div class="flex items-center justify-between mb-3">
		<h2 class="font-bold text-(--color-text)">{m.variation_picker_heading()}</h2>
		{#if variant === 'modal'}
			<button aria-label={m.picker_close_aria()} onclick={onclose} class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400">✕</button>
		{/if}
	</div>

	{#if chapters === null}
		{#if errorMessage}
			<p class="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
		{:else}
			<p class="text-sm text-(--color-muted)">{m.variation_picker_loading()}</p>
		{/if}
	{:else if openChapters.length === 0}
		<p class="text-sm text-(--color-muted)">{m.variation_picker_all_learned()}</p>
	{:else if openFolder}
		<button onclick={() => (openFolderKey = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
		<ul class="space-y-1">
			{#each openFolder.items as unit (unit.unitKey)}
				{@const active = isActive(unit.variationKey)}
				<li>
					<button
						onclick={() => onselect(unit.variationKey)}
						use:scrollIntoViewIfActive={active}
						class="block w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {active
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''}"
					>
						{unit.label}
					</button>
				</li>
			{/each}
		</ul>
	{:else if activeChapter}
		{#if chapterList !== null}
			<button onclick={() => (openChapter = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
		{/if}
		<ul class="space-y-1">
			{#each folders as group (folderKey(group))}
				{@const only = soleUnit(group)}
				{@const active = only ? isActive(only.variationKey) : groupHasActive(group)}
				<li>
					<!-- A folder of one IS a unit, so it selects straight into
					     teaching and renders like a unit row (own full label, no
					     count) rather than as a folder holding one item. Folders
					     of several still drill in. -->
					<button
						onclick={() => {
							if (only) onselect(only.variationKey);
							else openFolderKey = folderKey(group);
						}}
						use:scrollIntoViewIfActive={active}
						class="relative block w-full text-left px-3 py-2 {only ? '' : 'pr-12 font-medium'} rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) {active
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''}"
					>
						{only ? only.label : groupLabel(group)}
						{#if !only}
							<span class="absolute top-2 right-2 text-(--color-muted) text-sm">({group.items.length})</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="space-y-1">
			{#each chapterList ?? [] as chapter (chapter.chapter)}
				<li>
					<button
						onclick={() => {
							openChapter = chapter.chapter;
							// Start teaching the chapter's first unit. Never empty —
							// `openChapters` only lists chapters that still have one.
							const unit = chapter.units[0];
							if (unit) onselectchapter(unit.variationKey);
						}}
						class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-(--color-text) flex items-center justify-between gap-2 {chapterHasActive(
							chapter
						)
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''}"
					>
						<span class="truncate">{chapter.chapter}</span>
						{#if variant === 'inline'}
							{@render bandChip(chapter)}
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
	<!-- `w-full`, not the flex default: as a flex item with `width: auto` this
	     sizes to its content, which on desktop exceeds the rail's `lg:w-64` and
	     so fills it by accident. Below the board on mobile (GitHub issue #219)
	     the labels are narrower than the viewport, and the panel was left
	     hanging at content width with a dead gutter beside it. -->
	<div class="h-full w-full flex flex-col bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm overflow-y-auto p-4">
		{@render body()}
	</div>
{/if}
