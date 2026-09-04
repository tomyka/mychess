# Chapter Selection and Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the uploader choose which chapters of a multi-chapter PGN enter a repertoire, and let a coach remove a chapter from a repertoire that already exists.

**Architecture:** Two independent halves. Part 1 (Tasks 1-4) is client-only — the PGN is already parsed in the browser by `planMultiImport`, so a chapter review step is pure component work with no schema change and no new route. Part 2 (Tasks 5-9) adds a coach page whose destructive work goes through a new pure `planChapterRemoval` plus one extended RPC, reusing the re-upload flow's `beginUpdate` staleness claim and `retired_at` soft delete. All decision logic lands in pure `$lib` modules with colocated tests; Supabase I/O stays in the route/`$lib/server` and is verified manually, per this repo's documented split.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Supabase (Postgres + RLS), Tailwind 4, vitest (+ jsdom pragma for component tests), paraglide for i18n.

**Spec:** `docs/superpowers/specs/2026-09-04-chapter-selection-and-removal-design.md`
**Issue:** [tomyka/mychess#184](https://github.com/tomyka/mychess/issues/184)

**All `npm`/`npx` commands run from the `mychess/` subdirectory, not the repo root.**

---

## File Structure

**Part 1 — selection at upload**

| File | Responsibility |
|---|---|
| `src/lib/pgn-import.ts` (modify) | Gains `describeChapter` — pure per-chapter metadata (lines, ply depth, opening moves, the advisory `gameLike` flag) from an unwritten `ImportChapter`. |
| `src/lib/pgn-import.test.ts` (modify) | Tests for `describeChapter`. |
| `src/lib/components/ChapterSelectionList.svelte` (create) | A polarity-neutral checkable chapter list: summary line, tri-state master checkbox, Select all / none / invert, title filter. Knows nothing about importing or removing. |
| `src/lib/components/ChapterSelectionList.test.ts` (create) | Component tests for the above. |
| `src/lib/components/PgnImportForm.svelte` (modify) | Gains the second step and filters the plan to the selected chapters before its existing per-chapter import loop. |
| `src/lib/components/PgnImportForm.test.ts` (modify) | Two-step flow tests; three existing multi-chapter tests updated for the new step. |

**Part 2 — removal after**

| File | Responsibility |
|---|---|
| `src/lib/repertoire-chapter-removal.ts` (create) | Pure: `summarizeChapters` (per-chapter line/shared counts + exclusive variation keys) and `planChapterRemoval` (which moves to retire, and the repertoire's shape afterwards). |
| `src/lib/repertoire-chapter-removal.test.ts` (create) | Tests for both. |
| `supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql` (create) | Extends `apply_repertoire_update` with `p_remove_chapters text[]`. Applied manually. |
| `src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts` (create) | Request boundary: load the chapter impacts, validate the removal request, claim the repertoire, call the RPC. |
| `src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte` (create) | The manager UI, reusing `ChapterSelectionList`. |
| `src/routes/(coach)/coach/repertoires/+page.svelte` (modify) | A "Chapters" link on each repertoire card. |
| `messages/en.json`, `messages/lt.json` (modify) | New keys for both parts, plus the player-side chapter-checkbox reword. |

---

## Task 1: `describeChapter` — pure per-chapter metadata

**Files:**
- Modify: `mychess/src/lib/pgn-import.ts`
- Test: `mychess/src/lib/pgn-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `mychess/src/lib/pgn-import.test.ts`. If the file's existing imports don't already include `describeChapter` / `planMultiImport`, add them to the existing top-level import from `./pgn-import`.

```ts
describe('describeChapter', () => {
	/**
	 * A linear chain of `plies` synthetic edges. `describeChapter` walks
	 * fromFen → toFen edges and never validates chess legality, so fake
	 * position strings are the honest way to test depth without hand-writing
	 * 40 legal moves.
	 */
	function linearChapter(plies: number, name = 'Chapter'): ImportChapter {
		return {
			name,
			ecoCode: null,
			ecoName: null,
			moves: Array.from({ length: plies }, (_, i) => ({
				fromFen: `p${i}`,
				toFen: `p${i + 1}`,
				san: `m${i}`,
				move_number: i + 1,
				is_player_turn: i % 2 === 0,
				annotation: null
			}))
		};
	}

	it('counts lines and plies for a real single-line chapter', () => {
		const plan = planMultiImport('1. e4 e5 *', 'white');
		if ('error' in plan) throw new Error(plan.error);
		const description = describeChapter(plan[0]);
		expect(description.lineCount).toBe(1);
		expect(description.maxPly).toBe(2);
		expect(description.avgPly).toBe(2);
		expect(description.openingLabel).toBe('1.e4 e5');
	});

	it('flags a deep, barely-branching chapter as game-like', () => {
		const description = describeChapter(linearChapter(40));
		expect(description.lineCount).toBe(1);
		expect(description.maxPly).toBe(40);
		expect(description.gameLike).toBe(true);
	});

	it('does not flag a deep chapter that branches widely', () => {
		// One 40-ply spine plus five sibling leaves off its root — deep, but
		// six lines, so it is repertoire-shaped rather than a merged game.
		const chapter = linearChapter(40);
		for (let i = 0; i < 5; i++) {
			chapter.moves.push({
				fromFen: 'p0',
				toFen: `branch${i}`,
				san: `b${i}`,
				move_number: 1,
				is_player_turn: true,
				annotation: null
			});
		}
		const description = describeChapter(chapter);
		expect(description.lineCount).toBe(6);
		expect(description.gameLike).toBe(false);
	});

	it('does not flag a shallow single-line chapter', () => {
		const description = describeChapter(linearChapter(20));
		expect(description.avgPly).toBe(20);
		expect(description.gameLike).toBe(false);
	});

	it('reports zero lines for a chapter the player never moves in', () => {
		// enumerateVariations only yields lines with playerMoveCount > 0 — such
		// a chapter can never be drilled or solved, so it contributes nothing.
		const chapter = linearChapter(4);
		chapter.moves = chapter.moves.map((m) => ({ ...m, is_player_turn: false }));
		const description = describeChapter(chapter);
		expect(description.lineCount).toBe(0);
		expect(description.gameLike).toBe(false);
		expect(description.openingLabel).toBe('');
	});

	it('truncates the opening label to the first eight plies', () => {
		const description = describeChapter(linearChapter(40));
		expect(description.openingLabel.split(' ')).toHaveLength(8);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pgn-import.test.ts`
Expected: FAIL — `describeChapter is not a function` (or a TypeScript/import resolution error naming `describeChapter`).

- [ ] **Step 3: Implement `describeChapter`**

In `mychess/src/lib/pgn-import.ts`, add to the imports at the top of the file. Import only `RawMoveRow`, `enumerateVariations` and `moveSequenceLabel` — `variations.ts` also exports a `MoveRow` type of its own (a move-grid row) which would collide with this module's `MoveRow`:

```ts
import { enumerateVariations, moveSequenceLabel, type RawMoveRow } from './mastery/variations';
```

Then add, after the `ImportChapter` / `MultiImportPlan` type declarations:

```ts
/**
 * A chapter looks like whole games rather than repertoire theory when its
 * lines are long and barely branch. Repertoire theory fans out (many
 * variations sharing prefixes) and stops well before ply 30; a merged
 * annotated game is one deep, near-linear path with a handful of side notes.
 *
 * Deliberately conservative, and deliberately ADVISORY only — see
 * `ChapterDescription.gameLike`. A rule that silently deselected a chapter
 * would lose a coach's lines without them noticing.
 */
const GAME_LIKE_MIN_AVG_PLY = 30;
const GAME_LIKE_MAX_LINES = 4;

/** How many plies of the chapter's first line the review screen previews. */
const OPENING_LABEL_PLIES = 8;

export type ChapterDescription = {
	/** Enumerated variations — 0 when the player never moves in this chapter. */
	lineCount: number;
	maxPly: number;
	avgPly: number;
	/** e.g. "1.e4 e6 2.d4 d5 3.exd5 exd5 4.Nf3 Nf6" — '' when `lineCount` is 0. */
	openingLabel: string;
	/**
	 * Advisory hint that this chapter is probably not repertoire (see the
	 * thresholds above). NEVER acted on automatically: the review screen
	 * annotates the row and leaves its checkbox exactly as it was.
	 */
	gameLike: boolean;
};

/**
 * Per-chapter metadata for the import review screen, computed from moves that
 * are not written yet.
 *
 * Reuses the same synthesized-id trick `writeMoves` already applies to run
 * `enumerateVariations` over unwritten moves (see `$lib/server/pgn-import.ts`):
 * dedupe on `fromFen|san`, index-derived `id`, empty `chapterNames` — this
 * chapter is walked alone, so it has no chapter scoping to honour.
 *
 * Pure — no I/O — so it is directly testable, and cheap enough to run for
 * every chapter of a large PGN once, on the transition into the review step.
 */
export function describeChapter(chapter: ImportChapter): ChapterDescription {
	const deduped = Array.from(new Map(chapter.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
	const rawMoves: RawMoveRow[] = deduped.map((move, index) => ({
		id: String(index),
		fromPositionId: move.fromFen,
		toPositionId: move.toFen,
		fromFen: move.fromFen,
		toFen: move.toFen,
		san: move.san,
		isPlayerTurn: move.is_player_turn,
		chapterNames: []
	}));

	const variations = enumerateVariations(rawMoves);
	const plies = variations.map((v) => v.path.length);
	const lineCount = variations.length;
	const maxPly = lineCount === 0 ? 0 : Math.max(...plies);
	const avgPly = lineCount === 0 ? 0 : plies.reduce((sum, ply) => sum + ply, 0) / lineCount;

	return {
		lineCount,
		maxPly,
		avgPly,
		openingLabel: lineCount === 0 ? '' : moveSequenceLabel(variations[0].path.slice(0, OPENING_LABEL_PLIES)),
		gameLike: lineCount > 0 && lineCount <= GAME_LIKE_MAX_LINES && avgPly >= GAME_LIKE_MIN_AVG_PLY
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pgn-import.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/pgn-import.ts mychess/src/lib/pgn-import.test.ts
git commit -m "feat(import): describeChapter — pure per-chapter metadata for the review screen (GitHub issue #184)"
```

---

## Task 2: `ChapterSelectionList` component

**Files:**
- Create: `mychess/src/lib/components/ChapterSelectionList.svelte`
- Create: `mychess/src/lib/components/ChapterSelectionList.test.ts`
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1: Add the message keys**

The component's copy is generic to both callers ("Select all", "Invert", …); everything caller-specific — the heading, the summary line, the primary button, a read-only row's explanation — arrives as a prop or a row field, so the same component reads correctly whether checked means "will be imported" or "selected for removal".

Add to `mychess/messages/en.json`, inserted alphabetically near the other `chapter_*`/`coach_*` keys (the file is a flat JSON object of `"key": "value"` pairs — keep the existing 1-tab indentation):

```json
	"chapter_selection_select_all": "Select all",
	"chapter_selection_select_all_matching": "Select all {count} matching",
	"chapter_selection_select_none": "Select none",
	"chapter_selection_invert": "Invert",
	"chapter_selection_filter_label": "Filter chapters",
	"chapter_selection_filter_placeholder": "Filter chapters…",
	"chapter_selection_master_aria": "Select all chapters",
	"chapter_selection_row_aria": "Select {title}",
	"chapter_selection_no_matches": "No chapters match that filter.",
```

Add the same keys to `mychess/messages/lt.json`:

```json
	"chapter_selection_select_all": "Pasirinkti visus",
	"chapter_selection_select_all_matching": "Pasirinkti visus {count} atitinkančius",
	"chapter_selection_select_none": "Nepasirinkti nieko",
	"chapter_selection_invert": "Apversti",
	"chapter_selection_filter_label": "Filtruoti skyrius",
	"chapter_selection_filter_placeholder": "Filtruoti skyrius…",
	"chapter_selection_master_aria": "Pasirinkti visus skyrius",
	"chapter_selection_row_aria": "Pasirinkti {title}",
	"chapter_selection_no_matches": "Nė vienas skyrius neatitinka filtro.",
```

- [ ] **Step 2: Write the failing tests**

Create `mychess/src/lib/components/ChapterSelectionList.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import ChapterSelectionList, { type ChapterRow } from './ChapterSelectionList.svelte';

afterEach(cleanup);

const ROWS: ChapterRow[] = [
	{ id: '0', title: '1) Rare Moves #1', metaLine: '42 lines · 12 ply', detailLine: '1.e4 e6 2.d4 d5', selectable: true },
	{ id: '1', title: '4…Bf5 with 6…Nc6', metaLine: '38 lines · 14 ply', selectable: true },
	{ id: '2', title: 'Model games — Kramnik', metaLine: '2 lines · 44 ply', hint: '44 plies across 2 lines', selectable: true },
	{ id: '3', title: '4…Bf5 model games', metaLine: '9 lines · 6 ply', selectable: true }
];

/**
 * Renders with a real, mutable selection the component writes back into, so a
 * test can assert on what the parent would see rather than on internals.
 */
function renderList(selectedIds: string[], rows: ChapterRow[] = ROWS) {
	const props = $state({ rows, selectedIds: new Set(selectedIds), summary: '4 chapters' });
	render(ChapterSelectionList, { props });
	return props;
}

function master() {
	return screen.getByRole('checkbox', { name: 'Select all chapters' }) as HTMLInputElement;
}

describe('ChapterSelectionList', () => {
	it('renders one row per chapter, with its meta and detail lines', () => {
		renderList(['0', '1', '2', '3']);
		expect(screen.getByText('1) Rare Moves #1')).toBeTruthy();
		expect(screen.getByText('42 lines · 12 ply')).toBeTruthy();
		expect(screen.getByText('1.e4 e6 2.d4 d5')).toBeTruthy();
		expect(screen.getAllByRole('checkbox', { name: /^Select / })).toHaveLength(5); // 4 rows + master
	});

	it('shows the caller-supplied summary', () => {
		renderList([]);
		expect(screen.getByText('4 chapters')).toBeTruthy();
	});

	it('renders an advisory hint without changing the row selection', () => {
		const props = renderList(['0', '1', '2', '3']);
		expect(screen.getByText('44 plies across 2 lines')).toBeTruthy();
		expect(props.selectedIds.has('2')).toBe(true);
	});

	it('is checked when everything is selected and unchecked when nothing is', () => {
		renderList(['0', '1', '2', '3']);
		expect(master().checked).toBe(true);
		expect(master().indeterminate).toBe(false);
		cleanup();
		renderList([]);
		expect(master().checked).toBe(false);
		expect(master().indeterminate).toBe(false);
	});

	it('is indeterminate when only some are selected', () => {
		renderList(['0']);
		expect(master().indeterminate).toBe(true);
	});

	it('Select all selects every row; Select none clears them', async () => {
		const props = renderList(['0']);
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect([...props.selectedIds].sort()).toEqual(['0', '1', '2', '3']);
		await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
		expect(props.selectedIds.size).toBe(0);
	});

	it('Invert flips every row', async () => {
		const props = renderList(['0', '2']);
		await fireEvent.click(screen.getByRole('button', { name: 'Invert' }));
		expect([...props.selectedIds].sort()).toEqual(['1', '3']);
	});

	it('clicking the master checkbox when partially selected selects everything', async () => {
		const props = renderList(['0']);
		await fireEvent.click(master());
		expect(props.selectedIds.size).toBe(4);
	});

	it('filters rows by title', async () => {
		renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		expect(screen.getByText('Model games — Kramnik')).toBeTruthy();
		expect(screen.getByText('4…Bf5 model games')).toBeTruthy();
		expect(screen.queryByText('1) Rare Moves #1')).toBeNull();
	});

	it('Select all under an active filter selects only the visible rows', async () => {
		const props = renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching' }));
		expect([...props.selectedIds].sort()).toEqual(['2', '3']);
	});

	it('Select all under a filter does not re-select a hidden row the user rejected', async () => {
		const props = renderList(['0', '1', '3']);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'model games' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching' }));
		// '2' joins; '0' and '1' keep the state they already had; nothing hidden flips.
		expect([...props.selectedIds].sort()).toEqual(['0', '1', '2', '3']);
	});

	it('says so when a filter matches nothing', async () => {
		renderList([]);
		await fireEvent.input(screen.getByLabelText('Filter chapters'), { target: { value: 'zzz' } });
		expect(screen.getByText('No chapters match that filter.')).toBeTruthy();
	});

	it('renders a non-selectable row without a checkbox, showing its hint instead', () => {
		renderList([], [
			{ id: 'untagged', title: 'Lines without a chapter', metaLine: '5 lines', hint: 'Delete the repertoire instead', selectable: false }
		]);
		expect(screen.getByText('Lines without a chapter')).toBeTruthy();
		expect(screen.getByText('Delete the repertoire instead')).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'Select Lines without a chapter' })).toBeNull();
	});

	it('ignores non-selectable rows in the master aggregate and in bulk actions', async () => {
		const props = renderList([], [
			{ id: '0', title: 'A', metaLine: '1 line', selectable: true },
			{ id: 'untagged', title: 'Lines without a chapter', metaLine: '5 lines', selectable: false }
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect([...props.selectedIds]).toEqual(['0']);
		expect(master().checked).toBe(true);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/components/ChapterSelectionList.test.ts`
Expected: FAIL — the module `./ChapterSelectionList.svelte` cannot be resolved.

- [ ] **Step 4: Implement the component**

Create `mychess/src/lib/components/ChapterSelectionList.svelte`:

```svelte
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
	`import ChapterSelectionList, { type ChapterRow } from '…'`. Same shape
	`RepertoireDiffReview.svelte` uses for `ReviewPreview`/`ReviewDecisions`.
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
		selectedIds: Set<string>;
		/** One-line count summary above the list, phrased by the caller. */
		summary: string;
	};
	let { rows, selectedIds = $bindable(), summary }: Props = $props();

	let filter = $state('');

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
	 * Reassigns rather than mutating: `selectedIds` is a plain Set threaded
	 * through `$bindable`, so a parent's `$derived` over it only re-runs when
	 * the reference changes.
	 */
	function setSelection(next: Set<string>) {
		selectedIds = next;
	}

	function selectAllVisible() {
		const next = new Set(selectedIds);
		for (const row of actionable) next.add(row.id);
		setSelection(next);
	}

	function selectNoneVisible() {
		const next = new Set(selectedIds);
		for (const row of actionable) next.delete(row.id);
		setSelection(next);
	}

	function invertVisible() {
		const next = new Set(selectedIds);
		for (const row of actionable) {
			if (next.has(row.id)) next.delete(row.id);
			else next.add(row.id);
		}
		setSelection(next);
	}

	function toggleRow(id: string) {
		const next = new Set(selectedIds);
		if (!next.delete(id)) next.add(id);
		setSelection(next);
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
				<label class="sr-only" for="chapter_filter">{m.chapter_selection_filter_label()}</label>
				<input
					id="chapter_filter"
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/components/ChapterSelectionList.test.ts`
Expected: PASS (14 tests).

If the paraglide messages fail to resolve, run `npm test` once — a full test run regenerates `src/lib/paraglide/`. Do **not** run a bare `paraglide-js compile`, which writes to the wrong directory with the wrong strategy.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/components/ChapterSelectionList.svelte mychess/src/lib/components/ChapterSelectionList.test.ts mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(import): polarity-neutral ChapterSelectionList with bulk controls and a filter (GitHub issue #184)"
```

---

## Task 3: Two-step import flow in `PgnImportForm`

**Files:**
- Modify: `mychess/src/lib/components/PgnImportForm.svelte`
- Modify: `mychess/src/lib/components/PgnImportForm.test.ts`
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1: Add the message keys**

Add to `mychess/messages/en.json`, near the other `pgn_import_*` keys:

```json
	"pgn_import_review_heading": "Review chapters",
	"pgn_import_review_summary": "{total} chapters found · {selected} selected · {lines} lines will import",
	"pgn_import_review_meta": "{lines} lines · {ply} ply",
	"pgn_import_review_game_like_hint": "{ply} plies across {lines} lines — looks like whole games, not repertoire theory",
	"pgn_import_review_no_lines_hint": "No drillable lines — nothing here can be learned or practiced",
	"pgn_import_review_back": "Choose a different file",
	"pgn_import_review_import_button": "Import {count} chapters",
```

And to `mychess/messages/lt.json`:

```json
	"pgn_import_review_heading": "Peržiūrėti skyrius",
	"pgn_import_review_summary": "Rasta skyrių: {total} · pasirinkta: {selected} · bus importuota linijų: {lines}",
	"pgn_import_review_meta": "{lines} linijų · {ply} pusėjimų",
	"pgn_import_review_game_like_hint": "{ply} pusėjimų {lines} linijose — atrodo kaip visos partijos, o ne repertuaro teorija",
	"pgn_import_review_no_lines_hint": "Nėra treniruojamų linijų — čia nėra ko mokytis ar praktikuoti",
	"pgn_import_review_back": "Pasirinkti kitą failą",
	"pgn_import_review_import_button": "Importuoti {count} skyrius",
```

- [ ] **Step 2: Update the three existing multi-chapter tests**

These currently click the step-1 button and expect the import to run immediately. That is no longer true for a multi-chapter PGN, and updating them is the point of the change — not a regression. In `mychess/src/lib/components/PgnImportForm.test.ts`, add this helper below `fillBasicForm`:

```ts
/** Step 1 → review screen. Only a multi-chapter PGN gets a review screen. */
async function continueToReview(submitLabel = 'Create Repertoire') {
	await fireEvent.click(screen.getByRole('button', { name: submitLabel }));
	await waitFor(() => expect(screen.getByText('Review chapters')).toBeTruthy());
}
```

Then, in **`imports a multi-game PGN one chapter at a time into ONE shared repertoire`**, replace the single line

```ts
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));
```

with

```ts
		await continueToReview();
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }));
```

Make the identical replacement in **`rolls back the shared repertoire when a later chapter fails`**. Leave every single-chapter test exactly as it is — a single-game PGN must still import straight from step 1, and those tests are what prove it.

- [ ] **Step 3: Write the failing tests for the new behaviour**

Append inside the existing `describe('PgnImportForm', ...)` block:

```ts
	it('imports a single-game PGN straight from step 1, with no review screen', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(screen.queryByText('Review chapters')).toBeNull();
	});

	it('shows the review screen for a multi-chapter PGN and imports nothing yet', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		expect(screen.getByText('Line A')).toBeTruthy();
		expect(screen.getByText('Line B')).toBeTruthy();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('starts with every chapter selected, so an untouched review imports the whole file', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) }));

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		expect((screen.getByRole('checkbox', { name: 'Select Line A' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole('checkbox', { name: 'Select Line B' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByRole('button', { name: 'Import 2 chapters' })).toBeTruthy();
	});

	it('imports only the selected chapters', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		const threeGames =
			'[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Junk"]\n\n1. d4 d5 *\n\n[Event "Line C"]\n\n1. c4 c5 *';
		fillBasicForm('My Study', threeGames);
		await continueToReview();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Junk' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2 chapters' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const labels = fetchSpy.mock.calls.map((call) => JSON.parse(call[1].body).chapterLabel);
		expect(labels).toEqual(['Line A', 'Line C']);
		// finalize is relative to the SELECTED chapters, not the file's.
		expect(JSON.parse(fetchSpy.mock.calls[0][1].body).finalize).toBe(false);
		expect(JSON.parse(fetchSpy.mock.calls[1][1].body).finalize).toBeUndefined();
	});

	it('omits chapterLabel when exactly one chapter of many is selected', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line B' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 1 chapters' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.chapterLabel).toBeUndefined(); // one chapter has nothing to group
		expect(body.finalize).toBeUndefined();
	});

	it('disables the import button when nothing is selected', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		vi.stubGlobal('fetch', vi.fn());

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();

		await fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
		expect((screen.getByRole('button', { name: 'Import 0 chapters' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('goes back to step 1 without importing', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Study', '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *');
		await continueToReview();
		await fireEvent.click(screen.getByRole('button', { name: 'Choose a different file' }));

		await waitFor(() => expect(screen.getByLabelText('Repertoire Name')).toBeTruthy());
		expect(fetchSpy).not.toHaveBeenCalled();
	});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: FAIL — the new tests time out waiting for the text `Review chapters`, and the two tests updated in Step 2 fail the same way.

- [ ] **Step 5: Implement the two-step flow**

In `mychess/src/lib/components/PgnImportForm.svelte`:

**5a.** Extend the imports at the top of `<script>`:

```ts
	import { planMultiImport, describeChapter, type ImportChapter, type ChapterDescription } from '$lib/pgn-import';
	import ChapterSelectionList, { type ChapterRow } from './ChapterSelectionList.svelte';
```

(The existing `import { planMultiImport } from '$lib/pgn-import';` line is replaced by the first of those.)

**5b.** Add state below the existing `let errorMessage = $state('');`:

```ts
	/**
	 * The review step (GitHub issue #184). A multi-chapter PGN stops here so
	 * the uploader can drop chapters that are not repertoire — model games,
	 * tactics sets, scratch chapters — before anything is written. A
	 * single-chapter PGN never sees it: there is nothing to choose between,
	 * and making every upload pay for a second screen is the one real cost of
	 * this shape.
	 */
	let step = $state<'form' | 'review'>('form');
	let plan = $state<ImportChapter[]>([]);
	let descriptions = $state<ChapterDescription[]>([]);
	/**
	 * Keyed by the chapter's INDEX in `plan`, not its title: `chapterName`
	 * falls back to an ordinal only when no header is distinguishing, so two
	 * chapters in one file can legitimately share a title.
	 */
	let selectedIds = $state<Set<string>>(new Set());

	const selectedIndexes = $derived(
		plan.map((_, index) => index).filter((index) => selectedIds.has(String(index)))
	);
	const selectedLineCount = $derived(
		selectedIndexes.reduce((sum, index) => sum + descriptions[index].lineCount, 0)
	);

	const reviewRows = $derived<ChapterRow[]>(
		plan.map((chapter, index) => {
			const description = descriptions[index];
			return {
				id: String(index),
				title: chapter.name,
				metaLine: m.pgn_import_review_meta({ lines: description.lineCount, ply: description.maxPly }),
				detailLine: description.openingLabel,
				// Advisory only — see `describeChapter`. Annotates the row and
				// leaves its checkbox exactly as the uploader left it.
				hint:
					description.lineCount === 0
						? m.pgn_import_review_no_lines_hint()
						: description.gameLike
							? m.pgn_import_review_game_like_hint({ ply: description.maxPly, lines: description.lineCount })
							: undefined,
				selectable: true
			};
		})
	);
```

**5c.** Replace the body of `handleSubmit` so step 1 only parses, and extract the import loop into its own function. The loop itself is unchanged apart from reading `chapters` from a parameter:

```ts
	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';

		const trimmedName = name.trim();
		const trimmedPgn = pgnText.trim();
		if (!trimmedName || !trimmedPgn) {
			errorMessage = m.pgn_import_missing_fields_error();
			return;
		}

		const parsed = planMultiImport(trimmedPgn, color);
		if ('error' in parsed) {
			errorMessage = parsed.error;
			return;
		}

		// One chapter has nothing to choose between — import it as before.
		if (parsed.length === 1) {
			void runImport(parsed);
			return;
		}

		plan = parsed;
		descriptions = parsed.map(describeChapter);
		selectedIds = new Set(parsed.map((_, index) => String(index)));
		step = 'review';
	}

	function backToForm() {
		step = 'form';
		plan = [];
		descriptions = [];
		selectedIds = new Set();
		chapters = [];
		errorMessage = '';
	}

	function importSelected() {
		void runImport(selectedIndexes.map((index) => plan[index]));
	}
```

Then rename the existing `handleSubmit`'s import loop into:

```ts
	async function runImport(chaptersToImport: ImportChapter[]) {
```

…and inside it, replace every reference to the old local `plan` with `chaptersToImport`, and `trimmedName` with `name.trim()`. Keep the existing doc comment, adding this paragraph to it:

```
	 * `chaptersToImport` is the SELECTED chapters, which is why
	 * `isMultiChapter` is derived from its length rather than the parsed
	 * file's: selecting exactly one chapter of many produces a genuinely
	 * single-chapter repertoire, so `chapterLabel` is correctly omitted and
	 * its `chapter_names` stay `[]`. `ecoCode`/`ecoName` likewise come from
	 * the first SELECTED chapter, since that is the call that creates the
	 * repertoire row.
```

**5d.** Wrap the markup. Everything currently inside `<form onsubmit={handleSubmit} …>` stays as the `{:else}` branch; add the review branch:

```svelte
{#if step === 'review'}
	<div class="space-y-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-sm">
		<h2 class="text-lg font-bold text-(--color-text)">{m.pgn_import_review_heading()}</h2>

		<ChapterSelectionList
			rows={reviewRows}
			bind:selectedIds
			summary={m.pgn_import_review_summary({
				total: plan.length,
				selected: selectedIndexes.length,
				lines: selectedLineCount
			})}
		/>

		<!--
			The existing per-chapter progress block, copied VERBATIM from the
			form: `PgnImportForm.svelte` lines 249-272 as of commit 8b2f6d2 —
			the whole `{#if chapters.length > 0} … {/if}` including the
			progress bar, the `doneCount / chapters.length` caption and the
			per-chapter status list. Copy it; do not retype it.
		-->
		{#if chapters.length > 0}
			<!-- ← paste lines 249-272 here -->
		{/if}

		<div class="flex items-center justify-end gap-3">
			<button
				type="button"
				onclick={backToForm}
				disabled={importing}
				class="text-sm font-semibold text-(--color-accent) hover:underline disabled:opacity-60"
			>
				{m.pgn_import_review_back()}
			</button>
			<button
				type="button"
				onclick={importSelected}
				disabled={importing || selectedIndexes.length === 0}
				class="rounded-xl bg-(--color-accent) px-5 py-2.5 font-bold text-white transition-colors hover:bg-(--color-accent-hover) disabled:cursor-not-allowed disabled:opacity-60"
			>
				{importing ? m.pgn_import_importing_label() : m.pgn_import_review_import_button({ count: selectedIndexes.length })}
			</button>
		</div>
	</div>
{:else}
	<!--
		The existing `<form onsubmit={handleSubmit} …>` element, unchanged —
		every field, both file buttons, the filename caption, the progress
		block and the submit button exactly as they are today. Wrap it in this
		branch; do not rewrite it.
	-->
{/if}
```

The progress block ends up in BOTH branches: a single-chapter import still runs from step 1 and needs its progress bar there, while a multi-chapter import now runs from the review screen and needs one there too. That duplication is two lines of markup against a shared `chapters` state — cheaper than a third component for a progress bar.

Keep the step-1 submit button's label as the existing `submitLabel` prop. Do **not** relabel it "Continue": the form cannot know whether the PGN is multi-chapter until it is parsed, and a single-chapter upload genuinely does import from that click.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: PASS — every pre-existing test plus the seven new ones.

- [ ] **Step 7: Commit**

```bash
git add mychess/src/lib/components/PgnImportForm.svelte mychess/src/lib/components/PgnImportForm.test.ts mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(import): review step to choose which chapters a multi-chapter PGN imports (GitHub issue #184)"
```

---

## Task 4: Part 1 verification gate

**Files:** none

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Run the type check**

Run: `npm run check`
Expected: `0 errors`. There is no tolerated baseline in this repo.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: 0 errors. Warnings (~164, mostly `no-explicit-any`) are pre-existing and not a baseline to clear.

- [ ] **Step 4: Push**

Part 1 needs no migration and is independently useful — it is the half that stops the problem happening again.

```bash
git push origin HEAD
```

---

## Task 5: `planChapterRemoval` and `summarizeChapters`

**Files:**
- Create: `mychess/src/lib/repertoire-chapter-removal.ts`
- Create: `mychess/src/lib/repertoire-chapter-removal.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `mychess/src/lib/repertoire-chapter-removal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UNTAGGED_CHAPTER, enumerateVariations, type RawMoveRow } from './mastery/variations';
import { planChapterRemoval, summarizeChapters } from './repertoire-chapter-removal';

/**
 * One move edge. Synthetic position ids — nothing here validates chess
 * legality, only how the graph is walked and how chapter names are carried.
 */
function move(id: string, from: string, to: string, chapterNames: string[], isPlayerTurn = true): RawMoveRow {
	return {
		id,
		fromPositionId: from,
		toPositionId: to,
		fromFen: from,
		toFen: to,
		san: `s${id}`,
		isPlayerTurn,
		chapterNames
	};
}

/**
 * Two chapters that share their first edge:
 *   m1 (A,B) → m2 (A)  = chapter A's line
 *              m3 (B)  = chapter B's line
 * A's line and B's line are distinct; m1 is shared by both.
 */
const SHARED_PREFIX: RawMoveRow[] = [
	move('m1', 'p0', 'p1', ['A', 'B']),
	move('m2', 'p1', 'p2', ['A'], false),
	move('m3', 'p1', 'p3', ['B'], false)
];

describe('planChapterRemoval', () => {
	it('retires a move whose only chapter is removed', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		expect(plan.retireMoveIds).toEqual(['m2']);
	});

	it('never retires a move a surviving chapter still claims', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		// m1 carries A and B; B survives, so the edge must stay walkable.
		expect(plan.retireMoveIds).not.toContain('m1');
	});

	it('retires a move shared only between chapters that are both removed', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A', 'B']);
		expect(plan.retireMoveIds.sort()).toEqual(['m1', 'm2', 'm3']);
		expect(plan.totalVariations).toBe(0);
	});

	it('recomputes the shape from the surviving moves', () => {
		const before = enumerateVariations(SHARED_PREFIX);
		expect(before).toHaveLength(2);

		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(true);
		expect(plan.chapterCount).toBe(1);
	});

	it('leaves has_chapters false and one implicit chapter when every named chapter goes', () => {
		// A tagged chapter alongside genuinely untagged lines: removing the
		// tagged one leaves an untagged remainder, which is not "chaptered".
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const plan = planChapterRemoval(mixed, ['A']);
		expect(plan.retireMoveIds.sort()).toEqual(['m1', 'm2']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(false);
		expect(plan.chapterCount).toBe(1); // the implicit UNTAGGED bucket
	});

	it('removes the untagged bucket by its sentinel name', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const plan = planChapterRemoval(mixed, [UNTAGGED_CHAPTER]);
		expect(plan.retireMoveIds.sort()).toEqual(['m3', 'm4']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(true);
	});

	it('is a no-op for an empty removal list', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, []);
		expect(plan.retireMoveIds).toEqual([]);
		expect(plan.totalVariations).toBe(2);
	});

	it('ignores a chapter name the repertoire does not have', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['Nope']);
		expect(plan.retireMoveIds).toEqual([]);
		expect(plan.totalVariations).toBe(2);
	});
});

describe('summarizeChapters', () => {
	it('reports each chapter with its line count and how many are shared', () => {
		// Both chapters' lines are distinct here, so nothing is shared at the
		// LINE level even though m1 is a shared edge.
		const impacts = summarizeChapters(enumerateVariations(SHARED_PREFIX));
		expect(impacts.map((i) => i.name)).toEqual(['A', 'B']);
		expect(impacts[0].lineCount).toBe(1);
		expect(impacts[0].sharedLineCount).toBe(0);
		expect(impacts[0].exclusiveVariationKeys).toEqual(['m1>m2']);
	});

	it('counts a line belonging to two chapters as shared under both', () => {
		// One single line tagged by both chapters — a cross-referenced tabiya.
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		const impacts = summarizeChapters(enumerateVariations(both));
		expect(impacts.map((i) => i.name)).toEqual(['A', 'B']);
		for (const impact of impacts) {
			expect(impact.lineCount).toBe(1);
			expect(impact.sharedLineCount).toBe(1);
			expect(impact.exclusiveVariationKeys).toEqual([]);
		}
	});

	it('includes the untagged bucket for a mixed repertoire', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const impacts = summarizeChapters(enumerateVariations(mixed));
		expect(impacts.map((i) => i.name)).toEqual(['A', UNTAGGED_CHAPTER]);
		const untagged = impacts[1];
		expect(untagged.lineCount).toBe(1);
		expect(untagged.sharedLineCount).toBe(0);
		expect(untagged.exclusiveVariationKeys).toEqual(['m3>m4']);
	});

	it('returns nothing for a repertoire with no chapter tags at all', () => {
		const untagged: RawMoveRow[] = [move('m1', 'p0', 'p1', []), move('m2', 'p1', 'p2', [], false)];
		expect(summarizeChapters(enumerateVariations(untagged))).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/repertoire-chapter-removal.test.ts`
Expected: FAIL — cannot resolve `./repertoire-chapter-removal`.

- [ ] **Step 3: Implement the module**

Create `mychess/src/lib/repertoire-chapter-removal.ts`:

```ts
// mychess/src/lib/repertoire-chapter-removal.ts
//
// What removing one or more chapters does to a repertoire (GitHub issue #184).
// Pure — no Supabase. The route that applies this lives at
// `(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts`, and the
// atomic write itself is `apply_repertoire_update`'s job (migration 0074).

import {
	UNTAGGED_CHAPTER,
	chapterTiers,
	enumerateVariations,
	hasChapterTags,
	rowsInChapterTier,
	type RawMoveRow,
	type Variation
} from '$lib/mastery/variations';
import { masterableChapters } from '$lib/mastery/repertoireStatus';

/** One chapter, as the manager page needs to describe it before a removal. */
export type ChapterImpact = {
	name: string;
	/** Lines belonging to this chapter, shared ones included. */
	lineCount: number;
	/**
	 * How many of those lines ANOTHER chapter also claims. Those lines survive
	 * this chapter's removal — the count exists so the confirm dialog can say
	 * so instead of overstating what is about to disappear.
	 */
	sharedLineCount: number;
	/**
	 * The keys of the lines only this chapter claims — the ones that genuinely
	 * go away. Used to count how many carry student progress.
	 */
	exclusiveVariationKeys: string[];
};

/**
 * Per-chapter impact for every tier of a repertoire, in `chapterTiers`' order
 * (first appearance, untagged bucket last). Empty for a repertoire with no
 * chapter tags anywhere — there is nothing to remove chapter-wise, and the
 * caller renders the repertoire as one indivisible unit.
 */
export function summarizeChapters(variations: Variation[]): ChapterImpact[] {
	const tiers = chapterTiers(variations);
	if (tiers === null) return [];

	return tiers.map((name) => {
		const rows = rowsInChapterTier(variations, name);
		// The untagged bucket's rows belong to no chapter by definition, so
		// they can never be shared — `chapterNames.length === 1` would read
		// false for every one of them.
		const exclusive =
			name === UNTAGGED_CHAPTER ? rows : rows.filter((row) => row.chapterNames.length === 1);
		return {
			name,
			lineCount: rows.length,
			sharedLineCount: rows.length - exclusive.length,
			exclusiveVariationKeys: exclusive.map((row) => row.variationKey)
		};
	});
}

export type ChapterRemovalPlan = {
	/** `p_retire_move_ids` for `apply_repertoire_update`. */
	retireMoveIds: string[];
	totalVariations: number;
	hasChapters: boolean;
	chapterCount: number;
};

/**
 * Which moves a chapter removal retires, and the repertoire's shape once it
 * has happened.
 *
 * A move is retired IFF **every** chapter it belongs to is being removed. A
 * move that keeps at least one chapter is kept and merely loses the removed
 * names — this is the same intersection-not-union subtlety the per-chapter
 * exclusions work had to get right (see
 * `docs/superpowers/specs/2026-08-19-per-chapter-practice-exclusions-design.md`),
 * and getting it backwards here would silently retire prefix edges a surviving
 * chapter still needs to walk its own paths. On a transposition-heavy
 * repertoire that is most of the file.
 *
 * An untagged move belongs to the implicit `UNTAGGED_CHAPTER` bucket, so it is
 * removable by that sentinel name and by nothing else. A move that survives
 * keeps its `chapterNames` empty rather than gaining the sentinel — the
 * sentinel is a UI tier, never a stored value.
 *
 * The three shape values are recomputed by re-enumerating the surviving move
 * set, so they account for lines that lose their only path as a side effect of
 * a retire rather than by being tagged themselves.
 *
 * Removing every chapter is representable (`totalVariations: 0`) but is
 * refused by the caller — an empty repertoire is a repertoire delete, not a
 * chapter removal.
 */
export function planChapterRemoval(
	moves: RawMoveRow[],
	namesToRemove: readonly string[]
): ChapterRemovalPlan {
	const removing = new Set(namesToRemove);
	const retireMoveIds: string[] = [];
	const survivors: RawMoveRow[] = [];

	for (const move of moves) {
		const names = move.chapterNames ?? [];
		const untagged = names.length === 0;
		const own = untagged ? [UNTAGGED_CHAPTER] : names;
		const kept = own.filter((name) => !removing.has(name));

		if (kept.length === 0) {
			retireMoveIds.push(move.id);
			continue;
		}
		survivors.push({ ...move, chapterNames: untagged ? [] : kept });
	}

	const variations = enumerateVariations(survivors);
	return {
		retireMoveIds,
		totalVariations: variations.length,
		hasChapters: hasChapterTags(variations),
		chapterCount: masterableChapters(variations).length
	};
}

/**
 * The keys of every line that genuinely disappears when `namesToRemove` go —
 * the union of those chapters' exclusive lines, minus any line another chapter
 * in the removal set does not also claim exclusively. Used for the confirm
 * dialog's aggregate counts, so a bulk removal reports one honest total rather
 * than the sum of per-chapter numbers (which double-counts a line two removed
 * chapters share).
 */
export function removedVariationKeys(
	variations: Variation[],
	namesToRemove: readonly string[]
): string[] {
	const removing = new Set(namesToRemove);
	return variations
		.filter((variation) => {
			const own = variation.chapterNames.length === 0 ? [UNTAGGED_CHAPTER] : variation.chapterNames;
			return own.every((name) => removing.has(name));
		})
		.map((variation) => variation.variationKey);
}

/** Whether `namesToRemove` covers every tier the repertoire has. */
export function removesEveryChapter(
	variations: Variation[],
	namesToRemove: readonly string[]
): boolean {
	const tiers = chapterTiers(variations);
	if (tiers === null) return true;
	const removing = new Set(namesToRemove);
	return tiers.every((tier) => removing.has(tier));
}

/**
 * Re-declared rather than `export { UNTAGGED_CHAPTER } from …` so the route
 * and the page need one import for everything chapter-removal-shaped. Matches
 * how `RepertoireDiffReview.svelte` re-declares its own re-exports.
 */
export { UNTAGGED_CHAPTER };
```

- [ ] **Step 4: Add tests for the two extra helpers**

Append to `mychess/src/lib/repertoire-chapter-removal.test.ts`:

```ts
describe('removedVariationKeys', () => {
	it('lists only the lines every one of whose chapters is being removed', () => {
		const variations = enumerateVariations(SHARED_PREFIX);
		expect(removedVariationKeys(variations, ['A'])).toEqual(['m1>m2']);
	});

	it('counts a line shared by two removed chapters exactly once', () => {
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		expect(removedVariationKeys(enumerateVariations(both), ['A', 'B'])).toEqual(['m1>m2']);
	});

	it('spares a line one of whose chapters survives', () => {
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		expect(removedVariationKeys(enumerateVariations(both), ['A'])).toEqual([]);
	});
});

describe('removesEveryChapter', () => {
	it('is true when the selection covers every tier', () => {
		expect(removesEveryChapter(enumerateVariations(SHARED_PREFIX), ['A', 'B'])).toBe(true);
	});

	it('is false when a tier survives', () => {
		expect(removesEveryChapter(enumerateVariations(SHARED_PREFIX), ['A'])).toBe(false);
	});

	it('counts the untagged bucket as a tier that must be covered', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		expect(removesEveryChapter(enumerateVariations(mixed), ['A'])).toBe(false);
		expect(removesEveryChapter(enumerateVariations(mixed), ['A', UNTAGGED_CHAPTER])).toBe(true);
	});
});
```

Extend the file's import from `./repertoire-chapter-removal` to include `removedVariationKeys` and `removesEveryChapter`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/repertoire-chapter-removal.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/repertoire-chapter-removal.ts mychess/src/lib/repertoire-chapter-removal.test.ts
git commit -m "feat(repertoire): pure chapter-removal planning and per-chapter impact (GitHub issue #184)"
```

---

## Task 6: Migration 0074 — `p_remove_chapters`

**Files:**
- Create: `mychess/supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql`

- [ ] **Step 1: Confirm 0074 is still the next free number**

Run: `ls mychess/supabase/migrations | tail -5`
Expected: the highest existing file is `0073_moves_import_order.sql`. If something newer has landed, rename this migration to the next free number and use that number everywhere below.

- [ ] **Step 2: Write the migration**

Create `mychess/supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql`:

```sql
-- mychess/supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql
--
-- #184: a coach removing a chapter from an existing repertoire. Removal IS a
-- repertoire update — it retires moves exactly as a re-upload omitting those
-- chapters does — so it reuses apply_repertoire_update (0063, extended by
-- 0069) rather than growing a parallel RPC with its own copy of the auth
-- block, the row lock and the shape refresh.
--
-- Two new steps, both driven by the new p_remove_chapters argument:
--
--   1. Strip the removed names from every move that carries one. A move left
--      with no names at all is exactly a move the caller already listed in
--      p_retire_move_ids (see planChapterRemoval in
--      $lib/repertoire-chapter-removal.ts), so the two steps agree by
--      construction rather than by one inferring the other.
--   2. Delete the now-orphaned per-chapter practice exclusions, across EVERY
--      player. This genuinely needs the function's `security definer`:
--      variation_chapter_practice_exclusions' RLS is `player_id = auth.uid()`
--      and these rows belong to other players. Beyond tidiness it stops a
--      chapter resurrected by a later re-upload from coming back PRE-HIDDEN
--      for whichever students had unchecked it.
--
-- The strip itself is no longer an RLS problem — 0068 gave a coach UPDATE on
-- the moves of a student-owned repertoire. It lives here for ATOMICITY: it
-- lands in the same call, under the same `select … for update` row lock, as
-- the retires and the cached-shape refresh. Split app-side, a failure between
-- the two leaves chapter_names stripped with a stale shape, or vice versa.
--
-- `create or replace` cannot change an argument list (it creates a second
-- overload), so the prior 7-argument version is dropped explicitly first —
-- the same precaution 0063 and 0069 each took.
drop function if exists public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int);

create or replace function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_unretire_move_ids uuid[],
  p_chapter_renames jsonb,
  p_total_variations int,
  p_has_chapters boolean,
  p_chapter_count int,
  p_remove_chapters text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_rename jsonb;
begin
  select player_id into v_owner
  from public.repertoires
  where id = p_repertoire_id
  for update;

  if not found then
    raise exception 'Repertoire % not found', p_repertoire_id;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  if v_owner is distinct from auth.uid()
     and not exists (
       select 1
       from public.coach_players cp
       where cp.player_id = v_owner
         and cp.coach_id = auth.uid()
         and cp.status = 'active'
     )
  then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  if jsonb_typeof(p_chapter_renames) = 'array' then
    for v_rename in select value from jsonb_array_elements(p_chapter_renames) loop
      if (v_rename ->> 'from') is not null and (v_rename ->> 'to') is not null then
        update public.moves
          set chapter_names = array_replace(
                chapter_names,
                (v_rename ->> 'from')::text,
                (v_rename ->> 'to')::text
              )
          where repertoire_id = p_repertoire_id
            and chapter_names @> array[(v_rename ->> 'from')::text];
      end if;
    end loop;
  end if;

  -- Renames run FIRST, deliberately: a rename maps an old name onto a new
  -- one, and the caller computed p_remove_chapters against the repertoire's
  -- CURRENT names. A removal request never carries renames (see the chapters
  -- route, which passes an empty array), so the two never interact in
  -- practice — but if they ever did, removing after renaming is the order
  -- that matches what the caller was looking at.
  if array_length(p_remove_chapters, 1) > 0 then
    -- array_agg over an empty set returns NULL, not '{}' — hence the coalesce.
    -- Without it a move losing its last name would get a NULL chapter_names,
    -- which enumerateVariations reads as "untagged" rather than "gone".
    update public.moves
      set chapter_names = coalesce(
            (select array_agg(n) from unnest(chapter_names) n where n <> all(p_remove_chapters)),
            '{}'::text[]
          )
      where repertoire_id = p_repertoire_id
        and chapter_names && p_remove_chapters;

    delete from public.variation_chapter_practice_exclusions
      where repertoire_id = p_repertoire_id
        and chapter_name = any(p_remove_chapters);
  end if;

  if array_length(p_retire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = now()
      where repertoire_id = p_repertoire_id
        and id = any(p_retire_move_ids)
        and retired_at is null;
  end if;

  if array_length(p_unretire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = null
      where repertoire_id = p_repertoire_id
        and id = any(p_unretire_move_ids)
        and retired_at is not null;
  end if;

  -- Refresh the cached shape (migrations 0036 / 0043 / 0069). Computed by the
  -- caller, which already walked the tree to produce the diff or the removal
  -- plan.
  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters,
        chapter_count = p_chapter_count,
        update_in_progress_at = null
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int, text[]) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], uuid[], jsonb, int, boolean, int, text[]) to authenticated;
```

`p_remove_chapters` has a `default`, so the existing re-upload `apply` call site — which passes seven named arguments and knows nothing about chapter removal — keeps working untouched. Do not add the argument to that call site.

- [ ] **Step 3: Hand the SQL to the user and WAIT**

There is no local Postgres, no linked Supabase CLI, and PostgREST cannot execute DDL, so this cannot be applied from here. Print the file's contents and ask the user to run it in the Supabase Dashboard SQL editor (or to trigger the `migrate.yml` GitHub Action).

**Do not proceed to Task 7 until the user confirms the migration ran.** A `?/remove` action calling an 8-argument overload that does not exist fails at runtime with a function-not-found error that looks nothing like a missing migration.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0074_apply_repertoire_update_remove_chapters.sql
git commit -m "feat(db): extend apply_repertoire_update with p_remove_chapters (GitHub issue #184)"
```

---

## Task 7: Chapter manager route — server

**Files:**
- Create: `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts`

Per this repo's documented split, Supabase I/O in a route is not unit-tested directly — every decision it makes lives in `$lib/repertoire-chapter-removal.ts`, which Task 5 covered. This task is verified by `npm run check` plus the manual pass in Task 10.

- [ ] **Step 1: Write the load function and the remove action**

Create `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts`:

```ts
// mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts
//
// The coach chapter manager (GitHub issue #184): list a repertoire's chapters
// with the cost of removing each, and remove the chosen ones for every
// assigned student at once.
//
// Same division of labour as the sibling `update` route: every decision lives
// in the pure module (`$lib/repertoire-chapter-removal`), the atomic write is
// the RPC's (`apply_repertoire_update`, migration 0074), and this file is the
// request boundary — validate untrusted input, then sequence the steps in the
// one order that is safe.

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations } from '$lib/mastery/variations';
import { fetchAllMoves, toRawMoveRows } from '$lib/server/practice-repertoire';
import { beginUpdate } from '$lib/server/repertoire-update';
import {
	planChapterRemoval,
	removedVariationKeys,
	removesEveryChapter,
	summarizeChapters,
	UNTAGGED_CHAPTER
} from '$lib/repertoire-chapter-removal';

/**
 * How many of `variationKeys` any player has progress on. Counted across
 * `variation_solved` and `variation_teaching_progress` — the two tables whose
 * rows key off a variation and would be left pointing at retired moves.
 *
 * Read-only, for the confirm dialog only: it never gates a removal. A coach
 * who wants a chapter gone gets it gone; the number is there so they know what
 * it costs first.
 *
 * Chunked because a chapter can hold more keys than fit in one `.in()` query
 * string, and a plain `head: true` count over a too-long URL fails rather than
 * truncating.
 */
async function countLinesWithProgress(
	supabase: App.Locals['supabase'],
	variationKeys: string[]
): Promise<number> {
	if (variationKeys.length === 0) return 0;

	const CHUNK = 200;
	const withProgress = new Set<string>();

	for (let i = 0; i < variationKeys.length; i += CHUNK) {
		const chunk = variationKeys.slice(i, i + CHUNK);
		const [solved, teaching] = await Promise.all([
			supabase.from('variation_solved').select('variation_key').in('variation_key', chunk),
			supabase.from('variation_teaching_progress').select('variation_key').in('variation_key', chunk)
		]);
		for (const row of solved.data ?? []) withProgress.add(row.variation_key);
		for (const row of teaching.data ?? []) withProgress.add(row.variation_key);
	}

	return withProgress.size;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	// The `(coach)` group's `+layout.server.ts` already gates
	// `profile.role === 'coach'`, so this only has to require a real account.
	await requireAccount(locals);

	const [{ data: repertoire }, { count: assignedStudentCount }] = await Promise.all([
		locals.supabase
			.from('repertoires')
			.select('id, name, color, moves_updated_at')
			.eq('id', params.repertoire_id)
			.maybeSingle(),
		locals.supabase
			.from('assigned_repertoires')
			.select('id', { count: 'exact', head: true })
			.eq('repertoire_id', params.repertoire_id)
	]);

	// Also covers a repertoire this coach may not read: RLS returns no row, and
	// "not found" is the right answer either way.
	if (!repertoire) throw error(404, 'Repertoire not found');

	const variations = enumerateVariations(toRawMoveRows(await fetchAllMoves(locals.supabase, params.repertoire_id)));
	const impacts = summarizeChapters(variations);

	const chapters = await Promise.all(
		impacts.map(async (impact) => ({
			name: impact.name,
			lineCount: impact.lineCount,
			sharedLineCount: impact.sharedLineCount,
			progressLineCount: await countLinesWithProgress(locals.supabase, impact.exclusiveVariationKeys)
		}))
	);

	return {
		repertoire,
		assignedStudentCount: assignedStudentCount ?? 0,
		chapters,
		untaggedChapterName: UNTAGGED_CHAPTER
	};
};

/** The chapter names the coach chose, validated for shape only. */
function parseRemoveChapters(raw: FormDataEntryValue | null): { names: string[] } | { error: string } {
	if (typeof raw !== 'string' || !raw) return { error: 'chapters is required' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'chapters must be valid JSON' };
	}

	if (!Array.isArray(parsed)) return { error: 'chapters must be an array' };
	if (parsed.length === 0) return { error: 'Select at least one chapter to remove' };
	for (const entry of parsed) {
		if (typeof entry !== 'string' || !entry) return { error: 'each chapter must be a non-empty string' };
	}

	return { names: parsed as string[] };
}

export const actions: Actions = {
	remove: async ({ params, request, locals }) => {
		await requireAccount(locals);
		const supabase = locals.supabase;

		// 1. Validate before touching a row.
		const fd = await request.formData();
		const parsed = parseRemoveChapters(fd.get('chapters'));
		if ('error' in parsed) return fail(400, { error: parsed.error });

		const movesUpdatedAt = fd.get('movesUpdatedAt');
		if (typeof movesUpdatedAt !== 'string' || !movesUpdatedAt) {
			return fail(400, { error: 'movesUpdatedAt is required' });
		}

		// 2. Claim the repertoire — ONE conditional UPDATE that both checks the
		// shape has not moved since the page was rendered and sets the deferral
		// flag, so the two cannot be split by a concurrent re-upload apply.
		const claimed = await beginUpdate(supabase, params.repertoire_id, movesUpdatedAt);
		if (!claimed) {
			return fail(409, { error: 'This repertoire changed since you opened this page. Reload and try again.' });
		}

		// 3. Recompute from the repertoire's live rows, and derive the retire set
		// from THAT — never from anything the client sent. Retiring is
		// destructive (it takes a line out of every assigned student's shape), so
		// a forged payload must not be able to retire arbitrary moves: the client
		// supplies chapter NAMES, and which moves those names cost is decided
		// here.
		const rawMoves = toRawMoveRows(await fetchAllMoves(supabase, params.repertoire_id));
		const variations = enumerateVariations(rawMoves);

		// A removal that empties the repertoire is a repertoire delete, not a
		// chapter removal. Checked server-side as well as in the UI, because the
		// UI is not the authority. A name the repertoire does not have simply
		// costs nothing, so this cannot be tricked by padding the list.
		if (removesEveryChapter(variations, parsed.names)) {
			return fail(400, {
				error: 'That would remove every chapter. Delete the repertoire itself instead.'
			});
		}

		const plan = planChapterRemoval(rawMoves, parsed.names);

		// 4. The atomic tail: strip the names, drop the orphaned per-chapter
		// exclusions, retire the moves, refresh the cached shape and clear the
		// flag — one transaction, under the RPC's own row lock.
		//
		// Invoked with the user-scoped `locals.supabase`, never a service-role
		// client: the RPC denies a caller whose `auth.uid()` is null, and a
		// `service_role` JWT carries no `sub`.
		const { error: rpcErr } = await supabase.rpc('apply_repertoire_update', {
			p_repertoire_id: params.repertoire_id,
			p_retire_move_ids: plan.retireMoveIds,
			p_unretire_move_ids: [],
			p_chapter_renames: [],
			p_total_variations: plan.totalVariations,
			p_has_chapters: plan.hasChapters,
			p_chapter_count: plan.chapterCount,
			p_remove_chapters: parsed.names
		});
		if (rpcErr) return fail(500, { error: rpcErr.message });

		return {
			removed: parsed.names.length,
			removedLineCount: removedVariationKeys(variations, parsed.names).length
		};
	}
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: `0 errors`.

If `App.Locals['supabase']` does not resolve as a type in this file, replace that parameter's type with `SupabaseClient` imported from `@supabase/supabase-js`, matching how `$lib/server/repertoire-update.ts` types its own `supabase` parameters.

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts"
git commit -m "feat(coach): chapter manager route — load impacts, remove chapters atomically (GitHub issue #184)"
```

---

## Task 8: Chapter manager route — UI, and the link to it

**Files:**
- Create: `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

- [ ] **Step 1: Add the message keys**

Add to `mychess/messages/en.json`:

```json
	"coach_chapters_heading": "Chapters in “{name}”",
	"coach_chapters_intro": "Removing a chapter takes its lines out of the repertoire for all {count} assigned students. This cannot be undone from here — re-uploading the PGN brings the chapter back.",
	"coach_chapters_summary": "{total} chapters · {selected} selected for removal",
	"coach_chapters_meta": "{lines} lines",
	"coach_chapters_meta_shared": "{lines} lines · {shared} shared",
	"coach_chapters_untagged_hint": "Not a chapter — these are the repertoire's untagged lines. Delete the repertoire itself instead.",
	"coach_chapters_removes_everything": "That would remove every chapter. Delete the repertoire itself instead.",
	"coach_chapters_none": "This repertoire has no chapters. Its lines were imported without chapter titles, so there is nothing to remove one at a time.",
	"coach_chapters_remove_button": "Remove {count} chapters",
	"coach_chapters_confirm_heading": "Remove {count} chapters?",
	"coach_chapters_confirm_lines": "Retires {lines} lines for all {students} assigned students.",
	"coach_chapters_confirm_progress": "{lines} of them carry student progress — kept, in case the chapter returns.",
	"coach_chapters_confirm_shared": "{lines} lines also belong to other chapters and will stay.",
	"coach_chapters_confirm_cancel": "Cancel",
	"coach_chapters_confirm_remove": "Remove",
	"coach_chapters_removed_heading": "Chapters removed",
	"coach_chapters_removed_body": "{count} chapters and {lines} lines were removed from “{name}”.",
	"coach_chapters_back_link": "Back to repertoires",
	"coach_chapters_link": "Chapters",
	"coach_chapters_error_fallback": "That removal could not be applied. Reload and try again.",
	"seo_coach_chapters_title": "Chapters — {name}",
```

Add to `mychess/messages/lt.json`:

```json
	"coach_chapters_heading": "„{name}“ skyriai",
	"coach_chapters_intro": "Pašalinus skyrių, jo linijos išnyksta iš repertuaro visiems {count} priskirtiems mokiniams. Iš čia to atšaukti negalima — skyrius grįžta iš naujo įkėlus PGN.",
	"coach_chapters_summary": "Skyrių: {total} · pašalinimui pasirinkta: {selected}",
	"coach_chapters_meta": "{lines} linijų",
	"coach_chapters_meta_shared": "{lines} linijų · {shared} bendrų",
	"coach_chapters_untagged_hint": "Tai ne skyrius — tai repertuaro linijos be skyriaus. Verčiau ištrinkite patį repertuarą.",
	"coach_chapters_removes_everything": "Taip būtų pašalinti visi skyriai. Verčiau ištrinkite patį repertuarą.",
	"coach_chapters_none": "Šis repertuaras neturi skyrių. Jo linijos buvo importuotos be skyrių pavadinimų, todėl nėra ko šalinti po vieną.",
	"coach_chapters_remove_button": "Pašalinti {count} skyrius",
	"coach_chapters_confirm_heading": "Pašalinti {count} skyrius?",
	"coach_chapters_confirm_lines": "Bus išimta {lines} linijų visiems {students} priskirtiems mokiniams.",
	"coach_chapters_confirm_progress": "Iš jų {lines} turi mokinių pažangą — ji išsaugoma, jei skyrius sugrįžtų.",
	"coach_chapters_confirm_shared": "{lines} linijų taip pat priklauso kitiems skyriams ir liks.",
	"coach_chapters_confirm_cancel": "Atšaukti",
	"coach_chapters_confirm_remove": "Pašalinti",
	"coach_chapters_removed_heading": "Skyriai pašalinti",
	"coach_chapters_removed_body": "Iš „{name}“ pašalinta {count} skyrių ir {lines} linijų.",
	"coach_chapters_back_link": "Atgal į repertuarus",
	"coach_chapters_link": "Skyriai",
	"coach_chapters_error_fallback": "Pašalinimo nepavyko pritaikyti. Perkraukite ir bandykite dar kartą.",
	"seo_coach_chapters_title": "Skyriai — {name}",
```

- [ ] **Step 2: Write the failing page tests**

This is where `ChapterSelectionList`'s *other* polarity gets asserted — the same component that reads "Import 2 chapters" on the upload screen must read "Remove 2 chapters" here. A regression that hardcodes one caller's copy fails this file.

Create `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts`, following the route-test shape already used by `mastery.test.ts`:

```ts
// mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';

afterEach(cleanup);

const UNTAGGED = 'Lines without a chapter';

function renderWith(data: Record<string, unknown> = {}) {
	render(Page, {
		props: {
			data: {
				repertoire: { id: 'r1', name: 'Freeze the French', color: 'white', moves_updated_at: '2026-09-01T00:00:00Z' },
				assignedStudentCount: 4,
				untaggedChapterName: UNTAGGED,
				chapters: [
					{ name: 'Rare Moves #1', lineCount: 42, sharedLineCount: 0, progressLineCount: 12 },
					{ name: 'Model games', lineCount: 61, sharedLineCount: 9, progressLineCount: 11 },
					{ name: 'Tactics warm-up', lineCount: 9, sharedLineCount: 0, progressLineCount: 0 }
				],
				...data
			}
		}
	});
}

describe('coach chapter manager', () => {
	it('lists each chapter with its line count, marking shared lines', () => {
		renderWith();
		expect(screen.getByText('42 lines')).toBeTruthy();
		expect(screen.getByText('61 lines · 9 shared')).toBeTruthy();
	});

	it('labels the primary action as a REMOVAL, not an import', () => {
		renderWith();
		expect(screen.getByRole('button', { name: 'Remove 0 chapters' })).toBeTruthy();
	});

	it('disables removal until something is selected', async () => {
		renderWith();
		expect((screen.getByRole('button', { name: 'Remove 0 chapters' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rare Moves #1' }));
		expect((screen.getByRole('button', { name: 'Remove 1 chapters' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('refuses a selection covering every chapter', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
		expect((screen.getByRole('button', { name: 'Remove 3 chapters' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText('That would remove every chapter. Delete the repertoire itself instead.')).toBeTruthy();
	});

	it('renders the untagged bucket read-only, with an explanation', () => {
		renderWith({
			chapters: [
				{ name: 'Rare Moves #1', lineCount: 42, sharedLineCount: 0, progressLineCount: 0 },
				{ name: UNTAGGED, lineCount: 5, sharedLineCount: 0, progressLineCount: 0 }
			]
		});
		expect(screen.queryByRole('checkbox', { name: `Select ${UNTAGGED}` })).toBeNull();
		expect(
			screen.getByText("Not a chapter — these are the repertoire's untagged lines. Delete the repertoire itself instead.")
		).toBeTruthy();
	});

	it('sums the confirm dialog over the whole selection, once', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rare Moves #1' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Model games' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 2 chapters' }));

		expect(screen.getByText('Remove 2 chapters?')).toBeTruthy();
		// 42 exclusive + (61 - 9) exclusive = 94; the 9 shared are reported separately.
		expect(screen.getByText('Retires 94 lines for all 4 assigned students.')).toBeTruthy();
		expect(screen.getByText('9 lines also belong to other chapters and will stay.')).toBeTruthy();
		expect(screen.getByText('23 of them carry student progress — kept, in case the chapter returns.')).toBeTruthy();
	});

	it('sends the selected chapter names and the shape they were computed against', async () => {
		renderWith();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tactics warm-up' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove 1 chapters' }));

		const form = screen.getByRole('button', { name: 'Remove' }).closest('form')!;
		const values = Object.fromEntries(new FormData(form).entries());
		expect(values.chapters).toBe(JSON.stringify(['Tactics warm-up']));
		expect(values.movesUpdatedAt).toBe('2026-09-01T00:00:00Z');
	});

	it('says so for a repertoire with no chapters at all', () => {
		renderWith({ chapters: [] });
		expect(
			screen.getByText(
				'This repertoire has no chapters. Its lines were imported without chapter titles, so there is nothing to remove one at a time.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run "src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts"`
Expected: FAIL — cannot resolve `./+page.svelte`.

- [ ] **Step 4: Write the page**

Create `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte`:

```svelte
<!-- mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte -->
<!--
	The coach chapter manager (GitHub issue #184).

	Reuses `ChapterSelectionList`, which is deliberately polarity-neutral: here
	a checked row means "selected for removal", and the heading, summary and
	primary button say so. Nothing destructive happens until the confirm panel,
	which states the real blast radius — aggregated over the whole selection,
	so a bulk removal reports one honest total rather than double-counting a
	line two removed chapters share.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import ChapterSelectionList, { type ChapterRow } from '$lib/components/ChapterSelectionList.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const repertoiresHref = '/coach/repertoires';

	let selectedIds = $state<Set<string>>(new Set());
	let confirming = $state(false);
	let removing = $state(false);
	let removeError = $state('');
	let removed = $state<{ count: number; lines: number } | null>(null);

	const selected = $derived(data.chapters.filter((chapter) => selectedIds.has(chapter.name)));
	const selectedNamesJson = $derived(JSON.stringify(selected.map((chapter) => chapter.name)));

	/**
	 * Aggregate cost of the current selection. `lineCount - sharedLineCount` is
	 * each chapter's exclusive lines — the ones that genuinely disappear. Summed
	 * over exclusive lines only, this cannot double-count: a line two selected
	 * chapters share is shared, so it is in neither chapter's exclusive count,
	 * and the server's own `removedVariationKeys` is the authority on the final
	 * number reported afterwards.
	 */
	const exclusiveLines = $derived(
		selected.reduce((sum, chapter) => sum + (chapter.lineCount - chapter.sharedLineCount), 0)
	);
	const sharedLines = $derived(selected.reduce((sum, chapter) => sum + chapter.sharedLineCount, 0));
	const progressLines = $derived(selected.reduce((sum, chapter) => sum + chapter.progressLineCount, 0));

	// Every chapter selected would empty the repertoire — that is a repertoire
	// delete, not a chapter removal. The action refuses it too; this only keeps
	// the coach from reaching a dead end.
	const removesEverything = $derived(
		data.chapters.length > 0 && selected.length === data.chapters.length
	);

	const rows = $derived<ChapterRow[]>(
		data.chapters.map((chapter) => {
			const untagged = chapter.name === data.untaggedChapterName;
			return {
				id: chapter.name,
				title: chapter.name,
				metaLine:
					chapter.sharedLineCount > 0
						? m.coach_chapters_meta_shared({ lines: chapter.lineCount, shared: chapter.sharedLineCount })
						: m.coach_chapters_meta({ lines: chapter.lineCount }),
				hint: untagged ? m.coach_chapters_untagged_hint() : undefined,
				// The untagged bucket is a UI tier, not a chapter — removing it
				// would empty the repertoire's un-chaptered remainder with no way
				// to name what came back.
				selectable: !untagged
			};
		})
	);
</script>

<svelte:head>
	<title>{m.seo_coach_chapters_title({ name: data.repertoire.name })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="mx-auto max-w-3xl px-4 py-6">
		{#if removed}
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-sm">
				<h1 class="text-xl font-bold text-(--color-text)">{m.coach_chapters_removed_heading()}</h1>
				<p class="mx-auto mt-2 max-w-prose text-sm text-(--color-muted)">
					{m.coach_chapters_removed_body({
						count: removed.count,
						lines: removed.lines,
						name: data.repertoire.name
					})}
				</p>
				<a
					href={repertoiresHref}
					class="mt-4 inline-block rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-(--color-accent-hover) focus:outline-2 focus:outline-offset-2 focus:outline-(--color-accent)"
				>
					{m.coach_chapters_back_link()}
				</a>
			</div>
		{:else}
			<h1 class="text-2xl font-bold text-(--color-text)">
				{m.coach_chapters_heading({ name: data.repertoire.name })}
			</h1>
			<p class="mt-1 max-w-prose text-sm text-(--color-muted)">
				{m.coach_chapters_intro({ count: data.assignedStudentCount })}
			</p>

			{#if removeError}
				<p class="mt-4 rounded-xl border border-(--color-diff-removed) px-4 py-2 text-sm text-(--color-diff-removed)">
					{removeError}
				</p>
			{/if}

			{#if data.chapters.length === 0}
				<p class="mt-4 max-w-prose rounded-xl border border-(--color-border) bg-(--color-surface) p-5 text-sm text-(--color-muted) shadow-sm">
					{m.coach_chapters_none()}
				</p>
			{:else}
				<div class="mt-4 space-y-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-sm">
					<ChapterSelectionList
						{rows}
						bind:selectedIds
						summary={m.coach_chapters_summary({ total: data.chapters.length, selected: selected.length })}
					/>

					{#if confirming}
						<div class="space-y-2 rounded-xl border border-(--color-diff-removed) p-4">
							<h2 class="font-bold text-(--color-text)">
								{m.coach_chapters_confirm_heading({ count: selected.length })}
							</h2>
							<p class="text-sm text-(--color-muted)">
								{m.coach_chapters_confirm_lines({ lines: exclusiveLines, students: data.assignedStudentCount })}
							</p>
							{#if progressLines > 0}
								<p class="text-sm text-(--color-muted)">
									{m.coach_chapters_confirm_progress({ lines: progressLines })}
								</p>
							{/if}
							{#if sharedLines > 0}
								<p class="text-sm text-(--color-muted)">
									{m.coach_chapters_confirm_shared({ lines: sharedLines })}
								</p>
							{/if}

							<form
								method="POST"
								action="?/remove"
								use:enhance={() => {
									// Disabled from this moment until the response lands: two
									// removals sharing one `movesUpdatedAt` can each be
									// computed against a shape the other has already changed.
									removing = true;
									removeError = '';
									return async ({ result }) => {
										if (result.type === 'success') {
											const payload = result.data as { removed?: number; removedLineCount?: number } | undefined;
											removed = { count: payload?.removed ?? selected.length, lines: payload?.removedLineCount ?? 0 };
											return;
										}
										removing = false;
										confirming = false;
										if (result.type === 'failure') {
											// Shown verbatim: the 409 tells the coach to reload,
											// and rewording it would lose the instruction.
											removeError = String(
												(result.data as { error?: string } | undefined)?.error ?? m.coach_chapters_error_fallback()
											);
										} else if (result.type === 'error') {
											removeError = result.error?.message ?? m.coach_chapters_error_fallback();
										}
									};
								}}
								class="flex items-center justify-end gap-3 pt-2"
							>
								<input type="hidden" name="chapters" value={selectedNamesJson} />
								<!-- The shape these counts were computed against; the server
								     refuses the removal if the repertoire has moved since. -->
								<input type="hidden" name="movesUpdatedAt" value={data.repertoire.moves_updated_at} />
								<button
									type="button"
									onclick={() => (confirming = false)}
									disabled={removing}
									class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--color-text) disabled:opacity-60"
								>
									{m.coach_chapters_confirm_cancel()}
								</button>
								<button
									type="submit"
									disabled={removing}
									class="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{m.coach_chapters_confirm_remove()}
								</button>
							</form>
						</div>
					{:else}
						<div class="flex items-center justify-end gap-3">
							<a
								href={repertoiresHref}
								class="rounded-xl border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--color-text)"
							>
								{m.coach_chapters_back_link()}
							</a>
							<button
								type="button"
								onclick={() => (confirming = true)}
								disabled={selected.length === 0 || removesEverything}
								class="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{m.coach_chapters_remove_button({ count: selected.length })}
							</button>
						</div>
						{#if removesEverything}
							<p class="text-right text-sm text-(--color-diff-removed)">
								{m.coach_chapters_removes_everything()}
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</main>
```

- [ ] **Step 5: Run the page tests to verify they pass**

Run: `npx vitest run "src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts"`
Expected: PASS (8 tests).

- [ ] **Step 6: Link to it from the repertoire list**

In `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`, the repertoire card already renders an Update link around line 107. Add a Chapters link immediately before it, matching the Update link's classes exactly:

```svelte
              <a href="/coach/repertoires/{rep.id}/chapters"
                 class="text-sm border border-(--color-border) text-(--color-text) px-3 py-1.5 rounded-lg font-medium hover:border-(--color-accent) hover:text-(--color-accent) transition-colors shrink-0">{m.coach_chapters_link()}</a>
```

Read the Update link's actual class string in the file and copy it verbatim rather than trusting the snippet above — the two must look like siblings.

- [ ] **Step 7: Verify**

Run: `npm test`
Expected: PASS.

Run: `npm run check`
Expected: `0 errors`.

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/+page.svelte" "mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/chapters.test.ts" "mychess/src/routes/(coach)/coach/repertoires/+page.svelte" mychess/messages/en.json mychess/messages/lt.json
git commit -m "feat(coach): chapter manager UI with an impact-aware confirm (GitHub issue #184)"
```

---

## Task 9: Player-side chapter checkbox reword

**Files:**
- Modify: `mychess/messages/en.json`, `mychess/messages/lt.json`

The player's per-chapter hide already works: unchecking a chapter in `RepertoireVariationTree` writes `variation_chapter_practice_exclusions`, which hides those lines from that player's Practice **and** Learn (`learn-units/+server.ts:38`). Only its label is wrong — it says "practice" while it governs both.

- [ ] **Step 1: Confirm no test asserts the current string**

Run: `grep -rn "in practice" mychess/src --include=*.test.ts`
Expected: matches only on the repertoire-level and move-group labels (`Include Ruy Lopez in practice`, `Include … in Ruy Lopez in practice`), never on a chapter heading ending in `(chapter)`. If a chapter-level assertion does appear, update it in the same commit.

- [ ] **Step 2: Change the value in both locales**

In `mychess/messages/en.json`, change the value of the existing key — do not add a new key, and do not touch the sibling `repertoire_include_aria` / move-group keys:

```json
	"repertoire_tree_chapter_include_aria": "Include {heading} in my Learn and Practice",
```

In `mychess/messages/lt.json`:

```json
	"repertoire_tree_chapter_include_aria": "Įtraukti {heading} į mano Mokymąsi ir Praktiką",
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mychess/messages/en.json mychess/messages/lt.json
git commit -m "fix(learn): say that a chapter checkbox governs Learn as well as Practice (GitHub issue #184)"
```

---

## Task 10: Final verification and close-out

**Files:** none

- [ ] **Step 1: Full gate**

Run each, from `mychess/`:

```bash
npm test
npm run check
npm run lint
```

Expected: PASS / `0 errors` / 0 errors. Do not push with any of the three failing.

- [ ] **Step 2: Push**

```bash
git push origin HEAD
```

- [ ] **Step 3: Verify Part 1 against a real multi-chapter PGN**

Upload a multi-chapter PGN through `/coach/pgn`. Confirm: the review step appears; every chapter starts checked; the line/ply columns are populated; deselecting two chapters imports exactly the rest; a single-game PGN still imports straight from step 1 with no review step.

- [ ] **Step 4: Verify Part 2 against the real "Freeze the French" repertoire**

That repertoire is the shared-line case this design turns on — 1,873 of its 5,118 move rows carry more than one chapter tag. Open `/coach/repertoires/<id>/chapters`, remove one chapter, then confirm with `npm run debug:learn-plan -- <repertoireId> <playerId>`:

- the removed chapter is gone from the chapter list
- no *other* chapter lost lines
- `total_variations` and `chapter_count` match the new chapter list
- lines the removed chapter shared with a surviving chapter are still present

- [ ] **Step 5: Verify the Learn plan end to end**

Run: `npm run qa:verify-learn -- "<path-to-multi-chapter.pgn>"`
Expected: passes, with the removed chapter absent from the rendered picker.

- [ ] **Step 6: Clean up any QA account**

If Step 5 or the manual passes created a throwaway account, delete it with the `SUPABASE_SERVICE_ROLE_KEY` in `mychess/.env` — narrowly, only the accounts this task created — and say what was deleted.

- [ ] **Step 7: Close the issue**

Only once every acceptance criterion in the issue is genuinely met, including the user's confirmation that migration 0074 ran:

```bash
gh issue close 184 --comment "Shipped: chapter selection on import (review step with bulk controls and a filter) and coach-side chapter removal (/coach/repertoires/[id]/chapters, migration 0074). Verified against the Freeze the French repertoire."
```

---

## Notes for the implementer

- **Every `npm`/`npx` command runs from `mychess/`**, not the repo root. Git commands run from either; the paths in this plan's `git add` lines are repo-root-relative.
- **Never run a bare `paraglide-js compile`** — it writes to the wrong directory with the wrong strategy. A full `npm test` run regenerates `src/lib/paraglide/` correctly.
- **`npm run check` and `npm run lint` must both be at zero errors before any push to `main`.** There is no tolerated baseline. `lint`'s ~164 warnings are pre-existing and deliberate.
- **Task 6 blocks Task 7.** Do not write code that calls the 8-argument RPC before the user confirms migration 0074 was applied.
- Part 1 (Tasks 1-4) is independently shippable. If Part 2 stalls on the migration, Part 1 still lands.
