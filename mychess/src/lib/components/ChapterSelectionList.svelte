<!-- mychess/src/lib/components/ChapterSelectionList.svelte -->
<!--
	A checkable chapter list with bulk controls and a title filter (GitHub
	issue #184), shared by the import review screen and the coach chapter
	manager.

	DELIBERATELY POLARITY-NEUTRAL. On the import screen a checked row means
	"will be imported"; on the manager page it means "selected for removal".
	This component therefore owns only the copy that is identical either way
	(Select all / none / invert, the filter) — the heading, the summary line,
	the primary action and any row's explanatory hint all arrive from the
	caller. Without that split one of the two callers would read backwards.
-->
<!--
	A `module` script, not the instance one: only a module-level export is a
	real component export, which is what lets a consumer write
	`import ChapterSelectionList, { type ChapterRow } from '…'`.
-->
<script lang="ts" module>
	export type ChapterRow = {
		/**
		 * Stable identity for the selection set. The manager page uses the
		 * chapter name; the import screen uses the chapter's index in the
		 * parsed plan, because two PGN games can carry the same title.
		 */
		id: string;
		title: string;
		/** Right-aligned counts, e.g. "42 lines · 12 ply". Caller-formatted. */
		metaLine: string;
		/** Optional second line, e.g. the chapter's opening moves. */
		detailLine?: string;
		/** Optional advisory text. Never acted on — it only annotates. */
		hint?: string;
		/** False for a row that exists but cannot be chosen (see `hint`). */
		selectable: boolean;
	};
</script>

<script lang="ts">
	import { aggregateState, checkboxState } from './checkboxState';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		rows: ChapterRow[];
		/** The current selection, owned by the caller. Read-only here. */
		selectedIds: Set<string>;
		/** One-line count summary above the list, phrased by the caller. */
		summary: string;
		/**
		 * The selection this component would like next. A callback rather than
		 * `$bindable` deliberately: it is the shape almost every component in
		 * this repo already uses (`ExploreControls`' `onstop`,
		 * `OpeningPicker`'s `onclose`), and it
		 * keeps the selection owned by exactly one place — the caller, which
		 * is also the party that derives its counts from it.
		 */
		onselect: (next: Set<string>) => void;
	};
	let { rows, selectedIds, summary, onselect }: Props = $props();

	let filter = $state('');

	/**
	 * Per-instance so the filter's `sr-only` label stays correctly associated
	 * even if a page ever renders two of these lists. A hardcoded id would
	 * silently break the second instance's label — and this component is
	 * deliberately shared by two callers, so a third is plausible.
	 */
	const filterId = $props.id();

	const selectable = $derived(rows.filter((row) => row.selectable));
	const visible = $derived(
		filter.trim() === ''
			? rows
			: rows.filter((row) => row.title.toLowerCase().includes(filter.trim().toLowerCase()))
	);
	/** The rows a bulk action may touch: visible AND selectable. */
	const actionable = $derived(visible.filter((row) => row.selectable));

	// Aggregates over every selectable row, not just the visible ones — the
	// master checkbox reports the whole list's state, so filtering never makes
	// it claim "all selected" while hidden rows are not.
	const masterState = $derived(aggregateState(selectable.map((row) => selectedIds.has(row.id))));

	const filtering = $derived(filter.trim() !== '');

	/**
	 * Every mutator below builds a NEW Set and hands it straight to `onselect`
	 * rather than mutating the one the caller owns — a mutated Set is the same
	 * reference, so the caller's `$derived` counts would never re-run.
	 *
	 * That handoff is also why a plain `Set` is correct here and
	 * `svelte/prefer-svelte-reactivity` is disabled on each construction: the
	 * Set is mutated ONLY in the few lines between `new Set(...)` and the
	 * `onselect` call, and never touched again afterwards. Reactivity comes
	 * from the caller reassigning its `$state` to this new reference, not from
	 * tracking mutations inside the collection — so `SvelteSet` would buy
	 * nothing. If a future edit ever mutates one of these Sets AFTER handing
	 * it over, that reasoning breaks and this needs `SvelteSet` instead.
	 */
	function selectAllVisible() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above: mutated only before handoff, never after
		const next = new Set(selectedIds);
		for (const row of actionable) next.add(row.id);
		onselect(next);
	}

	function selectNoneVisible() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above: mutated only before handoff, never after
		const next = new Set(selectedIds);
		for (const row of actionable) next.delete(row.id);
		onselect(next);
	}

	function invertVisible() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above: mutated only before handoff, never after
		const next = new Set(selectedIds);
		for (const row of actionable) {
			if (next.has(row.id)) next.delete(row.id);
			else next.add(row.id);
		}
		onselect(next);
	}

	function toggleRow(id: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above: mutated only before handoff, never after
		const next = new Set(selectedIds);
		if (!next.delete(id)) next.add(id);
		onselect(next);
	}

	// A partially-selected master checkbox selects everything; a fully
	// selected one clears. Matches how the picker's own tri-state parents
	// behave elsewhere in the app.
	function toggleMaster() {
		if (masterState === 'checked') selectNoneVisible();
		else selectAllVisible();
	}
</script>

<div class="space-y-2">
	<p class="text-sm text-(--color-muted)">{summary}</p>

	<div class="overflow-hidden rounded-xl border border-(--color-border)">
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--color-border) bg-(--color-surface) px-3 py-2">
			<label class="flex items-center">
				<input
					type="checkbox"
					use:checkboxState={masterState}
					onchange={toggleMaster}
					aria-label={m.chapter_selection_master_aria()}
					class="size-4 accent-(--color-accent)"
				/>
			</label>

			<button type="button" onclick={selectAllVisible} class="text-sm font-medium text-(--color-accent) hover:underline">
				{filtering ? m.chapter_selection_select_all_matching({ count: actionable.length }) : m.chapter_selection_select_all()}
			</button>
			<button type="button" onclick={selectNoneVisible} class="text-sm font-medium text-(--color-accent) hover:underline">
				{m.chapter_selection_select_none()}
			</button>
			<button type="button" onclick={invertVisible} class="text-sm font-medium text-(--color-accent) hover:underline">
				{m.chapter_selection_invert()}
			</button>

			<div class="ms-auto">
				<label class="sr-only" for={filterId}>{m.chapter_selection_filter_label()}</label>
				<input
					id={filterId}
					type="search"
					bind:value={filter}
					placeholder={m.chapter_selection_filter_placeholder()}
					class="w-48 rounded-lg border border-(--color-border) px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500"
				/>
			</div>
		</div>

		{#if visible.length === 0}
			<p class="px-3 py-4 text-sm text-(--color-muted)">{m.chapter_selection_no_matches()}</p>
		{:else}
			<ul class="max-h-96 divide-y divide-(--color-border) overflow-y-auto">
				{#each visible as row (row.id)}
					<li class="px-3 py-2">
						<div class="flex items-center gap-3">
							{#if row.selectable}
								<input
									type="checkbox"
									checked={selectedIds.has(row.id)}
									onchange={() => toggleRow(row.id)}
									aria-label={m.chapter_selection_row_aria({ title: row.title })}
									class="size-4 shrink-0 accent-(--color-accent)"
								/>
							{:else}
								<span class="size-4 shrink-0" aria-hidden="true"></span>
							{/if}
							<span class="min-w-0 flex-1 truncate text-sm text-(--color-text)">{row.title}</span>
							<span class="shrink-0 text-xs text-(--color-muted)">{row.metaLine}</span>
						</div>
						{#if row.detailLine}
							<p class="ms-7 truncate text-xs text-(--color-muted)">{row.detailLine}</p>
						{/if}
						{#if row.hint}
							<p class="ms-7 text-xs text-amber-600 dark:text-amber-400">{row.hint}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
